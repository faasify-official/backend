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

const REVIEWS_TABLE = process.env.REVIEWS_TABLE
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
  const queryParams = event.queryStringParameters || {}

  console.log('Received request:', { httpMethod, path, queryParams })

  try {
    // GET - Get reviews by itemId
    if (httpMethod === 'GET') {
      return await handleGetReviews(event, queryParams)
    }

    // POST - Create a new review
    if (httpMethod === 'POST') {
      return await handleCreateReview(event)
    }

    return sendResponse(405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('Error:', error)
    return sendResponse(500, { error: error.message || 'Internal server error' })
  }
}

async function handleGetReviews(event, queryParams) {
  const itemId = queryParams.itemId

  if (!itemId) {
    return sendResponse(400, { error: 'itemId query parameter is required' })
  }

  try {
    // Verify item exists
    const itemResult = await docClient.send(
      new GetCommand({
        TableName: ITEMS_TABLE,
        Key: { id: itemId },
      })
    )

    if (!itemResult.Item) {
      return sendResponse(404, { error: 'Item not found' })
    }

    // Query reviews by itemId using GSI
    let result
    try {
      console.log('Querying reviews for itemId:', itemId)
      result = await docClient.send(
        new QueryCommand({
          TableName: REVIEWS_TABLE,
          IndexName: 'ItemIdIndex',
          KeyConditionExpression: 'itemId = :itemId',
          ExpressionAttributeValues: {
            ':itemId': itemId,
          },
        })
      )
      console.log('GSI query successful, found', result.Items?.length || 0, 'reviews')
    } catch (gsiError) {
      // If GSI doesn't exist, fall back to scanning and filtering
      console.warn('ItemIdIndex GSI not found, falling back to scan:', gsiError.message)
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: REVIEWS_TABLE,
          FilterExpression: 'itemId = :itemId',
          ExpressionAttributeValues: {
            ':itemId': itemId,
          },
        })
      )
      result = scanResult
      console.log('Scan successful, found', result.Items?.length || 0, 'reviews')
    }

    const reviews = result.Items || []

    // Sort reviews by createdAt (newest first)
    reviews.sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt)
    })

    // Calculate average rating
    const ratings = reviews.map((review) => review.rating).filter((r) => r !== undefined)
    const averageRating =
      ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0

    return sendResponse(200, {
      reviews,
      averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal place
      totalReviews: reviews.length,
    })
  } catch (error) {
    console.error('Error getting reviews:', error)
    return sendResponse(500, { error: 'Failed to get reviews' })
  }
}

async function handleCreateReview(event) {
  // Verify authentication
  const decoded = verifyToken(event)
  if (!decoded) {
    return sendResponse(401, { error: 'Unauthorized: Invalid or missing token' })
  }

  const userId = decoded.userId
  const body = JSON.parse(event.body || '{}')
  const { itemId, rating, comment } = body

  // Validation
  if (!itemId) {
    return sendResponse(400, { error: 'itemId is required' })
  }

  if (rating === undefined || rating < 1 || rating > 5) {
    return sendResponse(400, { error: 'rating is required and must be between 1 and 5' })
  }

  if (!comment || comment.trim().length === 0) {
    return sendResponse(400, { error: 'comment is required' })
  }

  try {
    // Verify item exists
    const itemResult = await docClient.send(
      new GetCommand({
        TableName: ITEMS_TABLE,
        Key: { id: itemId },
      })
    )

    if (!itemResult.Item) {
      return sendResponse(404, { error: 'Item not found' })
    }

    // Check if user has already reviewed this item
    let existingReviews
    try {
      const queryResult = await docClient.send(
        new QueryCommand({
          TableName: REVIEWS_TABLE,
          IndexName: 'ItemIdIndex',
          KeyConditionExpression: 'itemId = :itemId',
          FilterExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':itemId': itemId,
            ':userId': userId,
          },
        })
      )
      existingReviews = queryResult.Items || []
    } catch (error) {
      // If GSI doesn't exist, use scan
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: REVIEWS_TABLE,
          FilterExpression: 'itemId = :itemId AND userId = :userId',
          ExpressionAttributeValues: {
            ':itemId': itemId,
            ':userId': userId,
          },
        })
      )
      existingReviews = scanResult.Items || []
    }

    if (existingReviews.length > 0) {
      return sendResponse(409, { error: 'You have already reviewed this item' })
    }

    // Create review
    const reviewId = uuidv4()
    const review = {
      reviewId,
      itemId,
      userId,
      rating: parseInt(rating),
      comment: comment.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await docClient.send(
      new PutCommand({
        TableName: REVIEWS_TABLE,
        Item: review,
      })
    )

    // Update item's average rating (optional - you might want to do this in a separate process)
    // For now, we'll calculate it on the fly when fetching reviews

    return sendResponse(201, {
      message: 'Review created successfully',
      review,
    })
  } catch (error) {
    console.error('Error creating review:', error)
    return sendResponse(500, { error: 'Failed to create review' })
  }
}

