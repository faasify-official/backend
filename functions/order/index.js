const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
  GetCommand,
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

const ORDERS_TABLE = process.env.ORDERS_TABLE
const CART_TABLE = process.env.CART_TABLE
const ITEMS_TABLE = process.env.ITEMS_TABLE
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

const verifyToken = (event) => {
  const authHeader = event.headers?.Authorization || event.headers?.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  const token = authHeader.substring(7)
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch (error) {
    return null
  }
}

exports.handler = async (event) => {
  // Handle CORS preflight
  const method = event.httpMethod || event.requestContext?.httpMethod || ''
  if (method === 'OPTIONS') {
    return sendResponse(200, { message: 'CORS preflight successful' })
  }

  // Get path and method
  const httpMethod = event.httpMethod || event.requestContext?.httpMethod || 'GET'
  const path = event.path || event.requestContext?.path || event.rawPath || '/'

  console.log('Received request:', { httpMethod, path })

  try {
    // GET - Get all orders for the authenticated user
    if (httpMethod === 'GET') {
      return await handleGetOrders(event)
    }

    // POST - Create a new order (checkout from cart)
    if (httpMethod === 'POST') {
      return await handleCreateOrder(event)
    }

    return sendResponse(405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('Error:', error)
    return sendResponse(500, { error: error.message || 'Internal server error' })
  }
}

async function handleGetOrders(event) {
  // Verify authentication
  const decoded = verifyToken(event)
  if (!decoded) {
    return sendResponse(401, { error: 'Unauthorized: Invalid or missing token' })
  }

  const userId = decoded.userId

  try {
    // Query orders by userId using GSI
    let result
    try {
      console.log('Querying orders for userId:', userId)
      result = await docClient.send(
        new QueryCommand({
          TableName: ORDERS_TABLE,
          IndexName: 'UserIdIndex',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': userId,
          },
        })
      )
      console.log('GSI query successful, found', result.Items?.length || 0, 'orders')
    } catch (gsiError) {
      // If GSI doesn't exist, fall back to scanning and filtering
      console.warn('UserIdIndex GSI not found, falling back to scan:', gsiError.message)
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: ORDERS_TABLE,
          FilterExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': userId,
          },
        })
      )
      result = scanResult
      console.log('Scan successful, found', result.Items?.length || 0, 'orders')
    }

    const orders = result.Items || []

    // Enrich orders with item details
    const enrichedOrders = await Promise.all(
      orders.map(async (order) => {
        if (order.items && Array.isArray(order.items)) {
          const enrichedItems = await Promise.all(
            order.items.map(async (item) => {
              try {
                const itemResult = await docClient.send(
                  new GetCommand({
                    TableName: ITEMS_TABLE,
                    Key: { id: item.itemId },
                  })
                )
                return {
                  ...item,
                  itemDetails: itemResult.Item || null,
                }
              } catch (error) {
                console.error(`Error fetching item ${item.itemId}:`, error)
                return {
                  ...item,
                  itemDetails: null,
                }
              }
            })
          )
          return {
            ...order,
            items: enrichedItems,
          }
        }
        return order
      })
    )

    return sendResponse(200, {
      orders: enrichedOrders,
    })
  } catch (error) {
    console.error('Error getting orders:', error)
    return sendResponse(500, { error: 'Failed to get orders' })
  }
}

async function handleCreateOrder(event) {
  // Verify authentication
  const decoded = verifyToken(event)
  if (!decoded) {
    return sendResponse(401, { error: 'Unauthorized: Invalid or missing token' })
  }

  const userId = decoded.userId
  const body = JSON.parse(event.body || '{}')
  const { items, shippingAddress, total } = body

  // Validation
  if (!items || !Array.isArray(items) || items.length === 0) {
    return sendResponse(400, { error: 'Items array is required and cannot be empty' })
  }

  if (!shippingAddress) {
    return sendResponse(400, { error: 'Shipping address is required' })
  }

  if (total === undefined || total <= 0) {
    return sendResponse(400, { error: 'Total must be a positive number' })
  }

  try {
    // Create order
    const orderId = uuidv4()
    const order = {
      orderId,
      userId,
      items,
      shippingAddress,
      total: parseFloat(total),
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await docClient.send(
      new PutCommand({
        TableName: ORDERS_TABLE,
        Item: order,
      })
    )

    // Clear cart after order is created (optional)
    // You might want to keep cart items for history, or delete them

    return sendResponse(201, {
      message: 'Order created successfully',
      order,
    })
  } catch (error) {
    console.error('Error creating order:', error)
    return sendResponse(500, { error: 'Failed to create order' })
  }
}

