import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import multer from 'multer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config()

const DEFAULT_CONFIG = {
  server: {
    name: 'My Self-Volt Server',
    port: process.env.PORT || 3001,
    cors: { enabled: true, origins: ['*'] }
  },
  storage: {
    type: 'json',
    json: { directory: './data', prettyPrint: true },
    database: { type: 'sqlite', filename: './data/volt.db' }
  },
  mainServer: {
    url: '',
    apiKey: '',
    autoPing: true,
    pingInterval: 60000
  },
  encryption: {
    enabled: true,
    defaultAlgorithm: 'AES-256-GCM'
  },
  voice: {
    enabled: true,
    bitrate: 64000,
    maxUsersPerChannel: 25
  },
  files: {
    enabled: true,
    maxFileSize: 10485760,
    allowedTypes: ['image/*', 'video/*', 'audio/*', '.pdf', '.doc', '.docx', '.txt'],
    storage: 'local',
    localPath: './uploads'
  },
  limits: {
    maxServers: 100,
    maxMembersPerServer: 10000,
    maxChannelsPerServer: 500,
    maxMessagesPerChannel: 50000
  },
  logging: {
    level: 'info',
    file: './logs/volt.log'
  }
}

const CONFIG_FILE = path.join(__dirname, 'config.json')

let config = { ...DEFAULT_CONFIG }

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    config = { ...DEFAULT_CONFIG, ...userConfig }
  } catch (err) {
    console.error('[Config] Error loading config:', err.message)
  }
}

const saveConfig = () => {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

const log = (level, message, ...args) => {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`
  console.log(logMessage, ...args)
  
  if (config.logging.file) {
    const logDir = path.dirname(config.logging.file)
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
    fs.appendFileSync(config.logging.file, logMessage + '\n')
  }
}

const DATA_DIR = path.join(__dirname, config.storage.json?.directory || './data')
const UPLOADS_DIR = path.join(__dirname, config.files?.localPath || './uploads')
const LOGS_DIR = path.join(__dirname, config.logging?.file ? path.dirname(config.logging.file) : './logs')

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: config.server.cors.enabled ? {
    origin: config.server.cors.origins,
    credentials: true
  } : false
})

app.use(cors(config.server.cors.enabled ? { origin: config.server.cors.origins } : {}))
app.use(express.json({ limit: '50mb' }))
app.use('/uploads', express.static(UPLOADS_DIR))

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`
    cb(null, unique)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: config.files?.maxFileSize || 10485760 }
})

const JSON_FILE = path.join(DATA_DIR, 'volt-data.json')

const loadJsonData = () => {
  try {
    if (fs.existsSync(JSON_FILE)) {
      return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'))
    }
  } catch (err) {
    log('error', 'Error loading JSON data:', err.message)
  }
  return {
    servers: [],
    messages: {},
    channels: {},
    members: {},
    roles: {},
    invites: {},
    e2e: {},
    files: {}
  }
}

const saveJsonData = (data) => {
  if (config.storage.type === 'json' && config.storage.json?.prettyPrint) {
    fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 2))
  } else {
    fs.writeFileSync(JSON_FILE, JSON.stringify(data))
  }
}

let data = loadJsonData()

const saveData = () => {
  try {
    if (config.storage.type === 'json') {
      saveJsonData(data)
    }
    return true
  } catch (err) {
    log('error', 'Error saving data:', err.message)
    return false
  }
}

const encryptData = (text, key) => {
  if (!config.encryption?.enabled) return text
  
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
  
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()
  
  return { iv: iv.toString('hex'), data: encrypted, tag: tag.toString('hex') }
}

const decryptData = (encryptedObj, key) => {
  if (!encryptedObj || !encryptedObj.data) return encryptedObj
  
  const iv = Buffer.from(encryptedObj.iv, 'hex')
  const tag = Buffer.from(encryptedObj.tag, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
  decipher.setAuthTag(tag)
  
  let decrypted = decipher.update(encryptedObj.data, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  
  return decrypted
}

const generateServerKey = () => crypto.randomBytes(32).toString('hex')

const onlineUsers = new Map()
const voiceChannels = new Map()
const activeCalls = new Map()

const pingMainServer = async () => {
  if (!config.mainServer?.url || !config.mainServer?.apiKey) {
    return
  }

  try {
    const response = await fetch(`${config.mainServer.url}/api/self-volt/ping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.mainServer.apiKey}`
      },
      body: JSON.stringify({
        name: config.server.name,
        ownerId: '',
        ownerUsername: ''
      })
    })

    if (response.ok) {
      log('info', 'Main server ping successful')
    }
  } catch (err) {
    log('warn', 'Main server ping failed:', err.message)
  }
}

if (config.mainServer.autoPing && config.mainServer.url && config.mainServer.apiKey) {
  setInterval(pingMainServer, config.mainServer.pingInterval || 60000)
}

io.use((socket, next) => {
  const token = socket.handshake.auth.token
  if (!token) {
    return next(new Error('Authentication required'))
  }
  socket.token = token
  next()
})

io.on('connection', (socket) => {
  log('info', 'Client connected:', socket.id)

  socket.on('authenticate', async (data) => {
    try {
      let userData = null
      
      if (data.serverId) {
        const server = data.servers.find(s => s.id === data.serverId)
        if (server) {
          userData = {
            id: data.userId,
            username: data.username,
            avatar: data.avatar,
            servers: data.servers
          }
        }
      }

      if (userData) {
        socket.user = userData
        socket.serverId = data.serverId
        socket.join(`server:${data.serverId}`)
        onlineUsers.set(socket.user.id, socket.id)
        socket.emit('authenticated', { user: socket.user })
      } else {
        socket.emit('auth_error', { error: 'Authentication failed' })
      }
    } catch (err) {
      socket.emit('auth_error', { error: err.message })
    }
  })

  socket.on('channel:join', (channelId) => {
    if (!socket.serverId) return
    socket.join(`channel:${channelId}`)
    socket.currentChannel = channelId
    log('info', `User ${socket.user?.id} joined channel ${channelId}`)
  })

  socket.on('channel:leave', (channelId) => {
    socket.leave(`channel:${channelId}`)
  })

  socket.on('message:send', (data) => {
    if (!socket.user || !socket.serverId) return

    let content = data.content
    if (data.encrypted && config.encryption?.enabled) {
      content = encryptData(data.content, data.serverKey)
    }

    const message = {
      id: uuidv4(),
      channelId: data.channelId,
      userId: socket.user.id,
      username: socket.user.username,
      avatar: socket.user.avatar,
      content,
      attachments: data.attachments,
      encrypted: data.encrypted || false,
      iv: data.iv || null,
      timestamp: new Date().toISOString()
    }

    if (!data.messages) data.messages = []
    data.messages.push(message)

    if (data.messages.length > (config.limits?.maxMessagesPerChannel || 50000)) {
      data.messages = data.messages.slice(-(config.limits?.maxMessagesPerChannel || 50000))
    }

    saveData()
    io.to(`channel:${data.channelId}`).emit('message:new', message)
  })

  socket.on('message:edit', ({ messageId, content, channelId }) => {
    if (!socket.user || !socket.serverId) return
    const messages = data.messages[channelId] || []
    const idx = messages.findIndex(m => m.id === messageId)
    if (idx !== -1 && messages[idx].userId === socket.user.id) {
      messages[idx].content = content
      messages[idx].editedAt = new Date().toISOString()
      saveData()
      io.to(`channel:${channelId}`).emit('message:edited', messages[idx])
    }
  })

  socket.on('message:delete', ({ messageId, channelId }) => {
    if (!socket.user || !socket.serverId) return
    const messages = data.messages[channelId] || []
    const idx = messages.findIndex(m => m.id === messageId)
    if (idx !== -1) {
      messages.splice(idx, 1)
      saveData()
      io.to(`channel:${channelId}`).emit('message:deleted', { messageId, channelId })
    }
  })

  socket.on('message:pin', ({ messageId, channelId }) => {
    if (!socket.serverId) return
    if (!data.pinned) data.pinned = {}
    if (!data.pinned[channelId]) data.pinned[channelId] = []
    const msg = (data.messages[channelId] || []).find(m => m.id === messageId)
    if (msg && !data.pinned[channelId].find(m => m.id === messageId)) {
      data.pinned[channelId].push(msg)
      saveData()
      io.to(`channel:${channelId}`).emit('message:pinned', msg)
    }
  })

  socket.on('reaction:add', ({ messageId, channelId, emoji, userId }) => {
    if (!data.reactions) data.reactions = {}
    if (!data.reactions[channelId]) data.reactions[channelId] = {}
    if (!data.reactions[channelId][messageId]) data.reactions[channelId][messageId] = []
    
    const reaction = data.reactions[channelId][messageId].find(r => r.emoji === emoji)
    if (reaction) {
      if (!reaction.users.includes(userId)) {
        reaction.users.push(userId)
      }
    } else {
      data.reactions[channelId][messageId].push({ emoji, users: [userId] })
    }
    
    saveData()
    io.to(`channel:${channelId}`).emit('reaction:updated', {
      messageId,
      channelId,
      reactions: data.reactions[channelId][messageId]
    })
  })

  socket.on('reaction:remove', ({ messageId, channelId, emoji, userId }) => {
    if (!data.reactions?.[channelId]?.[messageId]) return
    
    const reaction = data.reactions[channelId][messageId].find(r => r.emoji === emoji)
    if (reaction) {
      reaction.users = reaction.users.filter(u => u !== userId)
      if (reaction.users.length === 0) {
        data.reactions[channelId][messageId] = data.reactions[channelId][messageId].filter(r => r.emoji !== emoji)
      }
      saveData()
      io.to(`channel:${channelId}`).emit('reaction:updated', {
        messageId,
        channelId,
        reactions: data.reactions[channelId][messageId]
      })
    }
  })

  socket.on('voice:join', ({ channelId, serverId }) => {
    if (!socket.user || !config.voice?.enabled) return
    
    if (!voiceChannels.has(channelId)) {
      voiceChannels.set(channelId, new Map())
    }
    
    const channel = voiceChannels.get(channelId)
    if (channel.size >= (config.voice?.maxUsersPerChannel || 25)) {
      socket.emit('voice:error', { error: 'Channel is full' })
      return
    }
    
    channel.set(socket.user.id, {
      id: socket.user.id,
      username: socket.user.username,
      avatar: socket.user.avatar,
      socketId: socket.id,
      joinedAt: new Date().toISOString()
    })
    
    socket.join(`voice:${channelId}`)
    socket.currentVoiceChannel = channelId
    socket.serverId = serverId
    
    socket.to(`voice:${channelId}`).emit('voice:user-joined', {
      channelId,
      user: {
        id: socket.user.id,
        username: socket.user.username,
        avatar: socket.user.avatar
      }
    })
    
    socket.emit('voice:joined', {
      channelId,
      users: Array.from(channel.values())
    })
    
    log('info', `User ${socket.user.username} joined voice channel ${channelId}`)
  })

  socket.on('voice:leave', ({ channelId }) => {
    if (!socket.user) return
    
    if (voiceChannels.has(channelId)) {
      voiceChannels.get(channelId).delete(socket.user.id)
      
      socket.leave(`voice:${channelId}`)
      socket.to(`voice:${channelId}`).emit('voice:user-left', {
        channelId,
        userId: socket.user.id
      })
      
      if (voiceChannels.get(channelId).size === 0) {
        voiceChannels.delete(channelId)
      }
    }
    
    socket.currentVoiceChannel = null
  })

  socket.on('voice:mute', ({ channelId, muted }) => {
    if (!socket.user || !socket.currentVoiceChannel) return
    
    socket.to(`voice:${channelId}`).emit('voice:user-muted', {
      channelId,
      userId: socket.user.id,
      muted
    })
  })

  socket.on('voice:deafen', ({ channelId, deafened }) => {
    if (!socket.user || !socket.currentVoiceChannel) return
    
    socket.to(`voice:${channelId}`).emit('voice:user-deafened', {
      channelId,
      userId: socket.user.id,
      deafened
    })
  })

  socket.on('disconnect', () => {
    log('info', 'Client disconnected:', socket.id)
    
    if (socket.user && socket.currentVoiceChannel) {
      if (voiceChannels.has(socket.currentVoiceChannel)) {
        voiceChannels.get(socket.currentVoiceChannel).delete(socket.user.id)
        
        io.to(`voice:${socket.currentVoiceChannel}`).emit('voice:user-left', {
          channelId: socket.currentVoiceChannel,
          userId: socket.user.id
        })
        
        if (voiceChannels.get(socket.currentVoiceChannel).size === 0) {
          voiceChannels.delete(socket.currentVoiceChannel)
        }
      }
    }
    
    if (socket.user) {
      onlineUsers.delete(socket.user.id)
    }
  })
})

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    name: config.server.name,
    version: '1.0.0',
    features: {
      encryption: config.encryption?.enabled,
      voice: config.voice?.enabled,
      files: config.files?.enabled
    },
    timestamp: new Date().toISOString()
  })
})

app.get('/api/config', (req, res) => {
  res.json({
    name: config.server.name,
    features: {
      encryption: config.encryption?.enabled,
      voice: config.voice?.enabled,
      files: config.files?.enabled,
      storage: config.storage?.type
    }
  })
})

app.post('/api/config', (req, res) => {
  const { name, mainServerUrl, mainServerApiKey, voice, encryption, files } = req.body
  
  if (name) config.server.name = name
  if (mainServerUrl) config.mainServer.url = mainServerUrl
  if (mainServerApiKey) config.mainServer.apiKey = mainServerApiKey
  if (voice) config.voice = { ...config.voice, ...voice }
  if (encryption) config.encryption = { ...config.encryption, ...encryption }
  if (files) config.files = { ...config.files, ...files }
  
  saveConfig()
  
  if (config.mainServer.url) {
    pingMainServer()
  }
  
  res.json({ success: true })
})

app.get('/api/storage-info', (req, res) => {
  const stats = {
    servers: data.servers?.length || 0,
    messages: Object.values(data.messages || {}).reduce((sum, arr) => sum + (arr?.length || 0), 0),
    channels: Object.keys(data.channels || {}).reduce((sum, serverChannels) => sum + (serverChannels?.length || 0), 0),
    members: Object.values(data.members || {}).reduce((sum, arr) => sum + (arr?.length || 0), 0),
    files: Object.keys(data.files || {}).length,
    storageType: config.storage?.type
  }
  res.json(stats)
})

app.get('/api/servers', (req, res) => {
  res.json(data.servers || [])
})

app.post('/api/servers', (req, res) => {
  const { name, icon, description, ownerId, ownerUsername } = req.body
  
  if (data.servers?.length >= (config.limits?.maxServers || 100)) {
    return res.status(400).json({ error: 'Maximum servers limit reached' })
  }
  
  const serverKey = generateServerKey()
  
  const server = {
    id: uuidv4(),
    name,
    icon: icon || '',
    description: description || '',
    ownerId,
    ownerUsername,
    serverKey,
    settings: {
      maxMembers: config.limits?.maxMembersPerServer || 10000,
      maxChannels: config.limits?.maxChannelsPerServer || 500,
      encryptionRequired: false,
      inviteOnly: false
    },
    createdAt: new Date().toISOString()
  }

  if (!data.servers) data.servers = []
  data.servers.push(server)
  
  if (!data.channels) data.channels = {}
  if (!data.members) data.members = {}
  if (!data.roles) data.roles = {}
  if (!data.messages) data.messages = {}
  if (!data.invites) data.invites = {}

  const defaultChannels = [
    { id: uuidv4(), serverId: server.id, name: 'general', type: 'text', position: 0 },
    { id: uuidv4(), serverId: server.id, name: 'announcements', type: 'text', position: 1 },
    { id: uuidv4(), serverId: server.id, name: 'General', type: 'voice', position: 2 }
  ]
  
  data.channels[server.id] = defaultChannels
  data.roles[server.id] = [
    { id: 'owner', name: 'Owner', color: '#ff6b6b', permissions: ['all'], position: 0 },
    { id: 'member', name: 'Member', color: '#4ecdc4', permissions: ['view_channels', 'send_messages', 'connect', 'speak'], position: 1 }
  ]
  data.members[server.id] = []
  data.messages[server.id] = {}
  data.invites[server.id] = []

  saveData()
  log('info', `Server created: ${name}`)
  res.json(server)
})

app.get('/api/servers/:serverId', (req, res) => {
  const server = (data.servers || []).find(s => s.id === req.params.serverId)
  if (!server) {
    return res.status(404).json({ error: 'Server not found' })
  }
  
  server.channels = data.channels[server.id] || []
  server.members = data.members[server.id] || []
  server.roles = data.roles[server.id] || []
  server.invites = data.invites[server.id] || []
  
  res.json(server)
})

app.put('/api/servers/:serverId', (req, res) => {
  const { name, icon, description, settings } = req.body
  const serverIndex = (data.servers || []).findIndex(s => s.id === req.params.serverId)
  
  if (serverIndex === -1) {
    return res.status(404).json({ error: 'Server not found' })
  }
  
  if (name) data.servers[serverIndex].name = name
  if (icon !== undefined) data.servers[serverIndex].icon = icon
  if (description !== undefined) data.servers[serverIndex].description = description
  if (settings) data.servers[serverIndex].settings = { ...data.servers[serverIndex].settings, ...settings }
  
  saveData()
  res.json(data.servers[serverIndex])
})

app.get('/api/servers/:serverId/key', (req, res) => {
  const server = (data.servers || []).find(s => s.id === req.params.serverId)
  if (!server) {
    return res.status(404).json({ error: 'Server not found' })
  }
  res.json({ key: server.serverKey })
})

app.post('/api/servers/:serverId/rotate-key', (req, res) => {
  const serverIndex = (data.servers || []).findIndex(s => s.id === req.params.serverId)
  if (serverIndex === -1) {
    return res.status(404).json({ error: 'Server not found' })
  }
  
  data.servers[serverIndex].serverKey = generateServerKey()
  saveData()
  res.json({ key: data.servers[serverIndex].serverKey })
})

app.get('/api/servers/:serverId/channels', (req, res) => {
  const channels = data.channels[req.params.serverId] || []
  res.json(channels)
})

app.post('/api/servers/:serverId/channels', (req, res) => {
  const { name, type } = req.body
  const serverId = req.params.serverId
  
  const serverChannels = data.channels[serverId] || []
  if (serverChannels.length >= (config.limits?.maxChannelsPerServer || 500)) {
    return res.status(400).json({ error: 'Maximum channels limit reached' })
  }
  
  if (!data.channels[serverId]) data.channels[serverId] = []
  
  const channel = {
    id: uuidv4(),
    serverId,
    name,
    type: type || 'text',
    position: data.channels[serverId].length,
    settings: {
      rateLimit: 0,
      nsfw: false
    }
  }
  
  data.channels[serverId].push(channel)
  data.messages[channel.id] = []
  saveData()
  
  res.json(channel)
})

app.put('/api/channels/:channelId', (req, res) => {
  const { name, topic, nsfw, rateLimit } = req.body
  const channelId = req.params.channelId
  
  for (const serverId in data.channels) {
    const idx = (data.channels[serverId] || []).findIndex(c => c.id === channelId)
    if (idx !== -1) {
      if (name) data.channels[serverId][idx].name = name
      if (topic !== undefined) data.channels[serverId][idx].topic = topic
      if (nsfw !== undefined) data.channels[serverId][idx].settings = { ...data.channels[serverId][idx].settings, nsfw }
      if (rateLimit !== undefined) data.channels[serverId][idx].settings = { ...data.channels[serverId][idx].settings, rateLimit }
      saveData()
      return res.json(data.channels[serverId][idx])
    }
  }
  
  res.status(404).json({ error: 'Channel not found' })
})

app.delete('/api/channels/:channelId', (req, res) => {
  const channelId = req.params.channelId
  
  for (const serverId in data.channels) {
    const idx = (data.channels[serverId] || []).findIndex(c => c.id === channelId)
    if (idx !== -1) {
      data.channels[serverId].splice(idx, 1)
      delete data.messages[channelId]
      saveData()
      return res.json({ success: true })
    }
  }
  
  res.status(404).json({ error: 'Channel not found' })
})

app.get('/api/channels/:channelId/messages', (req, res) => {
  const { limit, before, after } = req.query
  const messages = data.messages[req.params.channelId] || []
  
  let filtered = messages
  if (before) {
    filtered = filtered.filter(m => m.timestamp < before)
  }
  if (after) {
    filtered = filtered.filter(m => m.timestamp > after)
  }
  
  const sorted = filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  const limited = limit ? sorted.slice(0, parseInt(limit)) : sorted
  
  res.json(limited)
})

app.get('/api/channels/:channelId/pins', (req, res) => {
  const pins = data.pinned?.[req.params.channelId] || []
  res.json(pins)
})

app.get('/api/servers/:serverId/members', (req, res) => {
  const members = data.members[req.params.serverId] || []
  res.json(members)
})

app.post('/api/servers/:serverId/members', (req, res) => {
  const { userId, username, avatar, roles } = req.body
  const serverId = req.params.serverId
  
  const serverMembers = data.members[serverId] || []
  if (serverMembers.length >= (config.limits?.maxMembersPerServer || 10000)) {
    return res.status(400).json({ error: 'Maximum members limit reached' })
  }
  
  if (!data.members[serverId]) data.members[serverId] = []
  
  const existing = data.members[serverId].find(m => m.id === userId)
  if (existing) {
    return res.json(existing)
  }
  
  const member = {
    id: userId,
    username,
    avatar: avatar || null,
    roles: roles || ['member'],
    joinedAt: new Date().toISOString()
  }
  
  data.members[serverId].push(member)
  saveData()
  
  res.json(member)
})

app.delete('/api/servers/:serverId/members/:userId', (req, res) => {
  const serverId = req.params.serverId
  const userId = req.params.userId
  
  if (data.members[serverId]) {
    data.members[serverId] = data.members[serverId].filter(m => m.id !== userId)
    saveData()
  }
  
  res.json({ success: true })
})

app.get('/api/servers/:serverId/roles', (req, res) => {
  const roles = data.roles[req.params.serverId] || []
  res.json(roles)
})

app.post('/api/servers/:serverId/roles', (req, res) => {
  const { name, color, permissions } = req.body
  const serverId = req.params.serverId
  
  if (!data.roles[serverId]) data.roles[serverId] = []
  
  const role = {
    id: uuidv4(),
    name,
    color: color || '#1fb6ff',
    permissions: permissions || [],
    position: data.roles[serverId].length
  }
  
  data.roles[serverId].push(role)
  saveData()
  
  res.json(role)
})

app.put('/api/servers/:serverId/roles/:roleId', (req, res) => {
  const { name, color, permissions } = req.body
  const serverId = req.params.serverId
  const roleId = req.params.roleId
  
  if (!data.roles[serverId]) {
    return res.status(404).json({ error: 'Server not found' })
  }
  
  const idx = data.roles[serverId].findIndex(r => r.id === roleId)
  if (idx === -1) {
    return res.status(404).json({ error: 'Role not found' })
  }
  
  data.roles[serverId][idx] = { ...data.roles[serverId][idx], name, color, permissions }
  saveData()
  
  res.json(data.roles[serverId][idx])
})

app.delete('/api/servers/:serverId/roles/:roleId', (req, res) => {
  const serverId = req.params.serverId
  const roleId = req.params.roleId
  
  if (data.roles[serverId]) {
    data.roles[serverId] = data.roles[serverId].filter(r => r.id !== roleId)
    saveData()
  }
  
  res.json({ success: true })
})

app.get('/api/servers/:serverId/invites', (req, res) => {
  const invites = data.invites[req.params.serverId] || []
  res.json(invites)
})

app.post('/api/servers/:serverId/invites', (req, res) => {
  const { maxUses, expiresIn } = req.body
  const serverId = req.params.serverId
  
  if (!data.invites[serverId]) data.invites[serverId] = []
  
  const invite = {
    code: uuidv4().slice(0, 8),
    serverId,
    createdAt: new Date().toISOString(),
    uses: 0,
    maxUses: maxUses || null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn).toISOString() : null
  }
  
  data.invites[serverId].push(invite)
  saveData()
  
  res.json(invite)
})

app.delete('/api/servers/:serverId/invites/:code', (req, res) => {
  const serverId = req.params.serverId
  const code = req.params.code
  
  if (data.invites[serverId]) {
    data.invites[serverId] = data.invites[serverId].filter(i => i.code !== code)
    saveData()
  }
  
  res.json({ success: true })
})

if (config.files?.enabled) {
  app.post('/api/upload', upload.array('files', 10), (req, res) => {
    const files = (req.files || []).map(file => ({
      id: uuidv4(),
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      url: `/uploads/${file.filename}`,
      uploadedAt: new Date().toISOString()
    }))
    
    files.forEach(file => {
      if (!data.files) data.files = {}
      data.files[file.id] = file
    })
    
    saveData()
    res.json({ attachments: files })
  })

  app.delete('/api/upload/:fileId', (req, res) => {
    const fileId = req.params.fileId
    const file = data.files?.[fileId]
    
    if (file) {
      const filePath = path.join(UPLOADS_DIR, file.filename)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      delete data.files[fileId]
      saveData()
    }
    
    res.json({ success: true })
  })
}

app.get('/api/e2e/status/:serverId', (req, res) => {
  const server = (data.servers || []).find(s => s.id === req.params.serverId)
  if (!server) {
    return res.status(404).json({ error: 'Server not found' })
  }
  
  res.json({
    enabled: server.settings?.encryptionRequired || false,
    keyId: server.e2eKeyId || null
  })
})

app.post('/api/e2e/enable/:serverId', (req, res) => {
  const serverIndex = (data.servers || []).findIndex(s => s.id === req.params.serverId)
  if (serverIndex === -1) {
    return res.status(404).json({ error: 'Server not found' })
  }
  
  const keyId = crypto.randomBytes(8).toString('hex')
  data.servers[serverIndex].settings = {
    ...data.servers[serverIndex].settings,
    encryptionRequired: true
  }
  data.servers[serverIndex].e2eKeyId = keyId
  
  saveData()
  res.json({ enabled: true, keyId })
})

app.post('/api/e2e/disable/:serverId', (req, res) => {
  const serverIndex = (data.servers || []).findIndex(s => s.id === req.params.serverId)
  if (serverIndex === -1) {
    return res.status(404).json({ error: 'Server not found' })
  }
  
  data.servers[serverIndex].settings = {
    ...data.servers[serverIndex].settings,
    encryptionRequired: false
  }
  
  saveData()
  res.json({ enabled: false })
})

const PORT = config.server.port || 3001

httpServer.listen(PORT, () => {
  log('info', `⚡ Self-Volt server running on port ${PORT}`)
  log('info', `📡 Features: Encryption=${config.encryption?.enabled}, Voice=${config.voice?.enabled}, Files=${config.files?.enabled}`)
  log('info', `💾 Storage: ${config.storage?.type}`)
  log('info', `🔗 Main Server: ${config.mainServer?.url ? 'Connected' : 'Standalone mode'}`)
  
  if (config.mainServer?.url && config.mainServer?.apiKey) {
    pingMainServer()
  }
})

export default app
