const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb')
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

const ITEMS_TABLE = process.env.ITEMS_TABLE

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
  // Handle CORS preflight - MUST be first
  const method = event.httpMethod || event.requestContext?.httpMethod || event.requestContext?.http?.method || ''
  if (method === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request')
    return sendResponse(200, { message: 'CORS preflight successful' })
  }

  // Get path and method
  const httpMethod = event.httpMethod || event.requestContext?.httpMethod || event.requestContext?.http?.method || 'GET'
  const path = event.path || event.requestContext?.path || event.rawPath || event.requestContext?.http?.path || '/'

  console.log('Received request:', { httpMethod, path })

  try {
    // POST - Add item to storefront
    if (httpMethod === 'POST') {
      return await handleAddItem(event)
    }

    // GET - Get all items for a storefront
    if (httpMethod === 'GET') {
      return await handleGetItems(event)
    }

    return sendResponse(405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('Error:', error)
    return sendResponse(500, { error: error.message || 'Internal server error' })
  }
}

async function handleAddItem(event) {
  const body = JSON.parse(event.body || '{}')
  const { name, description, price, category, image, storeId } = body

  // Validation
  if (!name || !description || price === undefined || !category || !storeId) {
    return sendResponse(400, {
      error: 'Missing required fields: name, description, price, category, storeId',
    })
  }

  // Validate price is a number
  const priceNum = parseFloat(price)
  if (isNaN(priceNum) || priceNum < 0) {
    return sendResponse(400, {
      error: 'Price must be a valid positive number',
    })
  }

  // Create item
  const itemId = uuidv4()
  const item = {
    id: itemId,
    storeId,
    name,
    description,
    price: priceNum,
    category,
    image: image || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=80',
    averageRating: 0,
    reviews: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  try {
    await docClient.send(
      new PutCommand({
        TableName: ITEMS_TABLE,
        Item: item,
      })
    )

    return sendResponse(201, {
      message: 'Item added successfully',
      item,
    })
  } catch (error) {
    console.error('Error adding item:', error)
    return sendResponse(500, { error: 'Failed to add item' })
  }
}

async function handleGetItems(event) {
  // Get storeId from query parameters
  const storeId = event.queryStringParameters?.storeId

  console.log('Getting items for storeId:', storeId)

  if (!storeId) {
    return sendResponse(400, { error: 'Missing required query parameter: storeId' })
  }

  try {
    // Try to query using StoreIdIndex GSI first
    let result
    try {
      console.log('Attempting to query using StoreIdIndex GSI...')
      result = await docClient.send(
        new QueryCommand({
          TableName: ITEMS_TABLE,
          IndexName: 'StoreIdIndex',
          KeyConditionExpression: 'storeId = :storeId',
          ExpressionAttributeValues: {
            ':storeId': storeId,
          },
        })
      )
      console.log('GSI query successful, found', result.Items?.length || 0, 'items')
    } catch (gsiError) {
      // If GSI doesn't exist, fall back to scanning and filtering
      console.warn('StoreIdIndex GSI not found, falling back to scan:', gsiError.message)
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: ITEMS_TABLE,
          FilterExpression: 'storeId = :storeId',
          ExpressionAttributeValues: {
            ':storeId': storeId,
          },
        })
      )
      result = scanResult
      console.log('Scan successful, found', result.Items?.length || 0, 'items')
    }

    const items = result.Items || []
    console.log('Returning', items.length, 'items for storeId:', storeId)
    return sendResponse(200, {
      items,
    })
  } catch (error) {
    console.error('Error getting items:', error)
    return sendResponse(500, { error: `Failed to get items: ${error.message}` })
  }
}

