const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb')
const jwt = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')

// Configure DynamoDB client
const dynamoConfig = {
  region: process.env.AWS_REGION || 'us-west-2',
}

if (process.env.DYNAMODB_ENDPOINT) {
  dynamoConfig.endpoint = process.env.DYNAMODB_ENDPOINT
}

const client = new DynamoDBClient(dynamoConfig)
const docClient = DynamoDBDocumentClient.from(client)

const STOREFRONTS_TABLE = process.env.STOREFRONTS_TABLE
const USERS_TABLE = process.env.USERS_TABLE
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'

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

// Verify JWT token and extract user info
const verifyToken = (event) => {
  const authHeader = event.headers?.Authorization || event.headers?.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  try {
    const token = authHeader.substring(7)
    const decoded = jwt.verify(token, JWT_SECRET)
    return decoded
  } catch (error) {
    return null
  }
}

exports.handler = async (event) => {
  // Handle CORS preflight - MUST be first
  const method = event.httpMethod || event.requestContext?.httpMethod || event.requestContext?.http?.method || ''
  if (method === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request')
    return sendResponse(200, { message: 'CORS preflight successful' })
  }

  // Get path and method
  const httpMethod = event.httpMethod || event.requestContext?.httpMethod || event.requestContext?.http?.method || 'GET'
  const path = event.path || event.requestContext?.path || event.rawPath || event.requestContext?.http?.path || '/'
  const route = `${httpMethod} ${path}`

  console.log('Received request:', { httpMethod, path, route, eventKeys: Object.keys(event) })

  try {
    // Create storefront
    if (route === 'POST /storefronts' || path.includes('/storefronts') && httpMethod === 'POST') {
      return await handleCreateStorefront(event)
    }

    // Get single storefront
    if (
      (route.includes('GET /storefronts/') && !path.includes('/storefronts/my')) ||
      (path.includes('/storefronts/') && httpMethod === 'GET' && !path.includes('/my'))
    ) {
      return await handleGetStorefront(event)
    }

    // Get my storefronts (seller's own storefronts)
    if (
      route === 'GET /storefronts/my' ||
      (path.includes('/storefronts/my') && httpMethod === 'GET')
    ) {
      return await handleGetMyStorefronts(event)
    }

    // List all storefronts
    if (route === 'GET /storefronts' || (path === '/storefronts' && httpMethod === 'GET')) {
      return await handleListStorefronts(event)
    }

    return sendResponse(404, { error: 'Not found', route })
  } catch (error) {
    console.error('Error:', error)
    return sendResponse(500, { error: error.message || 'Internal server error' })
  }
}

async function handleCreateStorefront(event) {
  const user = verifyToken(event)
  if (!user) {
    return sendResponse(401, { error: 'Unauthorized: Invalid or missing token' })
  }

  if (user.role !== 'seller') {
    return sendResponse(403, { error: 'Forbidden: Only sellers can create storefronts' })
  }

  const body = JSON.parse(event.body || '{}')
  const { name, description, category, image } = body

  // Validation
  if (!name || !description || !category) {
    return sendResponse(400, {
      error: 'Missing required fields: name, description, category',
    })
  }

  // Create storefront
  const storeId = uuidv4()
  const storefront = {
    storeId,
    name,
    description,
    category,
    image: image || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1400&q=80',
    owner: user.userId,
    ownerName: user.email, // Store owner email/name for display
    items: [], // Empty array initially
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  try {
    await docClient.send(
      new PutCommand({
        TableName: STOREFRONTS_TABLE,
        Item: storefront,
      })
    )

    // Update user to mark that they have a storefront
    await docClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: {
          userId: user.userId,
        },
        UpdateExpression: 'SET hasStorefront = :hasStorefront',
        ExpressionAttributeValues: {
          ':hasStorefront': true,
        },
      })
    )

    return sendResponse(201, {
      message: 'Storefront created successfully',
      storefront,
    })
  } catch (error) {
    console.error('Error creating storefront:', error)
    return sendResponse(500, { error: 'Failed to create storefront' })
  }
}

async function handleGetStorefront(event) {
  // Extract storeId from path
  const pathParams = event.pathParameters || {}
  const storeId = pathParams.storeId || event.path?.split('/').pop()

  if (!storeId) {
    return sendResponse(400, { error: 'Missing storeId in path' })
  }

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: STOREFRONTS_TABLE,
        Key: {
          storeId,
        },
      })
    )

    if (!result.Item) {
      return sendResponse(404, { error: 'Storefront not found' })
    }

    return sendResponse(200, {
      storefront: result.Item,
    })
  } catch (error) {
    console.error('Error getting storefront:', error)
    return sendResponse(500, { error: 'Failed to get storefront' })
  }
}

async function handleGetMyStorefronts(event) {
  const user = verifyToken(event)
  if (!user) {
    return sendResponse(401, { error: 'Unauthorized: Invalid or missing token' })
  }

  if (user.role !== 'seller') {
    return sendResponse(403, { error: 'Forbidden: Only sellers can view their storefronts' })
  }

  try {
    // Try to query using OwnerIndex GSI first
    // Note: 'owner' is a reserved keyword, so we use ExpressionAttributeNames
    let result
    try {
      result = await docClient.send(
        new QueryCommand({
          TableName: STOREFRONTS_TABLE,
          IndexName: 'OwnerIndex',
          KeyConditionExpression: '#owner = :owner',
          ExpressionAttributeNames: {
            '#owner': 'owner',
          },
          ExpressionAttributeValues: {
            ':owner': user.userId,
          },
        })
      )
    } catch (gsiError) {
      // If GSI doesn't exist, fall back to scanning and filtering
      console.warn('OwnerIndex GSI not found, falling back to scan:', gsiError.message)
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: STOREFRONTS_TABLE,
          FilterExpression: '#owner = :owner',
          ExpressionAttributeNames: {
            '#owner': 'owner',
          },
          ExpressionAttributeValues: {
            ':owner': user.userId,
          },
        })
      )
      result = scanResult
    }

    return sendResponse(200, {
      storefronts: result.Items || [],
    })
  } catch (error) {
    console.error('Error getting my storefronts:', error)
    return sendResponse(500, { error: `Failed to get storefronts: ${error.message}` })
  }
}

async function handleListStorefronts(event) {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: STOREFRONTS_TABLE,
      })
    )

    return sendResponse(200, {
      storefronts: result.Items || [],
    })
  } catch (error) {
    console.error('Error listing storefronts:', error)
    return sendResponse(500, { error: 'Failed to list storefronts' })
  }
}

