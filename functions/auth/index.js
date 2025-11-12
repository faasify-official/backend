const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')

// Configure DynamoDB client - use AWS region from environment or default
const dynamoConfig = {
  region: process.env.AWS_REGION || 'us-west-2',
}

// For local DynamoDB (if DYNAMODB_ENDPOINT is set)
if (process.env.DYNAMODB_ENDPOINT) {
  dynamoConfig.endpoint = process.env.DYNAMODB_ENDPOINT
}

const client = new DynamoDBClient(dynamoConfig)
const docClient = DynamoDBDocumentClient.from(client)

const USERS_TABLE = process.env.USERS_TABLE
const JWT_SECRET = process.env.JWT_SECRET

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const sendResponse = (statusCode, body, additionalHeaders = {}) => {
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      ...additionalHeaders,
    },
    body: JSON.stringify(body),
  }
}

exports.handler = async (event) => {
  // Handle CORS preflight - must be first
  const method = event.httpMethod || event.requestContext?.httpMethod || ''
  if (method === 'OPTIONS') {
    return sendResponse(200, { message: 'CORS preflight successful' })
  }

  // Get path and method - handle both SAM local and API Gateway formats
  const httpMethod = event.httpMethod || event.requestContext?.httpMethod || 'GET'
  const path = event.path || event.requestContext?.path || event.rawPath || '/'
  const route = `${httpMethod} ${path}`

  console.log('Received request:', { httpMethod, path, route })

  try {
    // Register endpoint
    if (route === 'POST /auth/register' || path.includes('/auth/register')) {
      return await handleRegister(event)
    }

    // Login endpoint
    if (route === 'POST /auth/login' || path.includes('/auth/login')) {
      return await handleLogin(event)
    }

    // Get profile endpoint
    if (route === 'GET /auth/profile' || path.includes('/auth/profile')) {
      return await handleGetProfile(event)
    }

    return sendResponse(404, { error: 'Not found', route })
  } catch (error) {
    console.error('Error:', error)
    return sendResponse(500, { error: error.message || 'Internal server error' })
  }
}

async function handleRegister(event) {
  const body = JSON.parse(event.body || '{}')
  const { name, email, password, role } = body

  // Validation
  if (!name || !email || !password || !role) {
    return sendResponse(400, { error: 'Missing required fields: name, email, password, role' })
  }

  if (!['buyer', 'seller'].includes(role)) {
    return sendResponse(400, { error: 'Role must be either "buyer" or "seller"' })
  }

  if (password.length < 6) {
    return sendResponse(400, { error: 'Password must be at least 6 characters' })
  }

  // Check if user already exists (optimized - only query if index exists)
  try {
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': email.toLowerCase(),
        },
        Limit: 1, // Only need to check if one exists, don't fetch all
      })
    )

    if (queryResult.Items && queryResult.Items.length > 0) {
      return sendResponse(409, { error: 'User with this email already exists' })
    }
  } catch (error) {
    // If index doesn't exist or query fails, continue (will fail on duplicate email at PutCommand)
    console.error('Error checking existing user:', error.message)
  }

  // Hash password - use fewer rounds for local dev, more for production
  // 10 rounds = ~200ms (secure but slow), 4 rounds = ~20ms (faster for dev)
  const bcryptRounds = process.env.NODE_ENV === 'production' ? 10 : 4
  const hashedPassword = await bcrypt.hash(password, bcryptRounds)

  // Create user
  const userId = uuidv4()
  const user = {
    userId,
    email: email.toLowerCase(),
    name,
    password: hashedPassword,
    role,
    hasStorefront: false,
    createdAt: new Date().toISOString(),
  }

  try {
    await docClient.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: user,
      })
    )

    // Generate JWT token
    const token = jwt.sign(
      {
        userId,
        email: user.email,
        role,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    // Return user data (without password)
    const { password: _, ...userWithoutPassword } = user
    return sendResponse(201, {
      message: 'User created successfully',
      user: userWithoutPassword,
      token,
    })
  } catch (error) {
    console.error('Error creating user:', error)
    return sendResponse(500, { error: 'Failed to create user' })
  }
}

async function handleLogin(event) {
  const body = JSON.parse(event.body || '{}')
  const { email, password } = body

  if (!email || !password) {
    return sendResponse(400, { error: 'Email and password are required' })
  }

  try {
    // Query user by email
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': email.toLowerCase(),
        },
      })
    )

    if (!queryResult.Items || queryResult.Items.length === 0) {
      return sendResponse(401, { error: 'Invalid email or password' })
    }

    const user = queryResult.Items[0]

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password)
    if (!isValidPassword) {
      return sendResponse(401, { error: 'Invalid email or password' })
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    // Return user data (without password)
    const { password: _, ...userWithoutPassword } = user
    return sendResponse(200, {
      message: 'Login successful',
      user: userWithoutPassword,
      token,
    })
  } catch (error) {
    console.error('Error during login:', error)
    return sendResponse(500, { error: 'Login failed' })
  }
}

async function handleGetProfile(event) {
  // Extract token from Authorization header
  const authHeader = event.headers?.Authorization || event.headers?.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendResponse(401, { error: 'Unauthorized: No token provided' })
  }

  const token = authHeader.substring(7)

  try {
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET)

    // Get user from database
    const result = await docClient.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: {
          userId: decoded.userId,
        },
      })
    )

    if (!result.Item) {
      return sendResponse(404, { error: 'User not found' })
    }

    // Return user data (without password)
    const { password: _, ...userWithoutPassword } = result.Item
    return sendResponse(200, {
      user: userWithoutPassword,
    })
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return sendResponse(401, { error: 'Invalid or expired token' })
    }
    console.error('Error getting profile:', error)
    return sendResponse(500, { error: 'Failed to get profile' })
  }
}

