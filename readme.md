# Lambda Items API

A serverless AWS Lambda application that provides a REST API for managing items using DynamoDB. Built with AWS SAM (Serverless Application Model) and Node.js.

## Overview

This project implements a serverless API endpoint that allows you to:
- **POST** items to create new entries in DynamoDB
- **GET** items by ID from DynamoDB

The application uses AWS Lambda for compute, API Gateway for HTTP endpoints, and DynamoDB for data storage.

## Architecture

- **Runtime**: Node.js 20.x
- **Framework**: AWS SAM (Serverless Application Model)
- **Database**: DynamoDB 
- **API**: API Gateway (REST API)

### Resources

- `ItemsFunction`: Lambda function handling GET and POST requests
- `ItemsTable`: DynamoDB table storing items with `id` as the primary key
- API Gateway endpoint at `/items`

## Prerequisites

- [AWS CLI](https://aws.amazon.com/cli/) installed and configured
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) installed
- Node.js 20.x or later
- An AWS account with appropriate permissions

## Setup

### 1. Configure AWS CLI

Configure your AWS credentials:

```bash
aws configure
```
If you want access to the shared AWS account, DM Pouyan on Discord for the account details.
Enter that account credentials from IAM into AWS CLI.

Enter your:
- AWS Access Key ID
- AWS Secret Access Key
- Default region (e.g., `us-west-2`)
- Default output format (`json`)

Verify your configuration:

```bash
aws sts get-caller-identity
```

### 2. Install Dependencies

Install the required Node.js packages:

```bash
npm install
```

## Local Development

### Build the Application

```bash
sam build
```

### Test Locally

#### Invoke the Function Directly

```bash
sam local invoke ItemsFunction -e functions/items/event.json
```

#### Run as Local API

Start the local API server:

```bash
sam local start-api
```

The API will be available at `http://localhost:3000`

#### Test Endpoints

**Create an item (POST):**
```powershell
curl -X POST http://localhost:3000/items -H "Content-Type: application/json" -d "{\"id\": \"123\", \"name\": \"Test Item\"}"
```

Or using PowerShell's `Invoke-RestMethod`:
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/items" -Method POST -ContentType "application/json" -Body '{"id": "123", "name": "Test Item"}'
```

**Get an item (GET):**
```powershell
curl "http://localhost:3000/items?id=123"
```

Or using PowerShell's `Invoke-RestMethod`:
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/items?id=123" -Method GET
```

## Deployment

### Build for Deployment

```bash
sam build
```

### Deploy to AWS (FOR LATER)

Deploy using guided mode (first time):

```bash
sam deploy --guided
```

Follow the prompts to provide:
- Stack name
- AWS Region
- Confirm IAM role creation
- Confirm changeset
- Save arguments to configuration file

For subsequent deployments, you can use:

```bash
sam deploy
```

### Test Deployed API

After deployment, SAM will output the API Gateway endpoint URL. Test it:

```powershell
# Create an item
curl -X POST https://<api-id>.execute-api.<region>.amazonaws.com/Prod/items -H "Content-Type: application/json" -d "{\"id\": \"123\", \"name\": \"Test Item\"}"

# Get an item
curl "https://<api-id>.execute-api.<region>.amazonaws.com/Prod/items?id=123"
```

Or using PowerShell's `Invoke-RestMethod`:
```powershell
# Create an item
Invoke-RestMethod -Uri "https://<api-id>.execute-api.<region>.amazonaws.com/Prod/items" -Method POST -ContentType "application/json" -Body '{"id": "123", "name": "Test Item"}'

# Get an item
Invoke-RestMethod -Uri "https://<api-id>.execute-api.<region>.amazonaws.com/Prod/items?id=123" -Method GET
```

## API Endpoints

### POST /items

Creates a new item in DynamoDB.

**Request Body:**
```json
{
  "id": "string",
  "name": "string"
}
```

**Response:**
```json
{
  "message": "Item added",
  "item": {
    "id": "string",
    "name": "string",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### GET /items?id={id}

Retrieves an item by ID from DynamoDB.

**Query Parameters:**
- `id` (required): The ID of the item to retrieve

**Response:**
```json
{
  "id": "string",
  "name": "string",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

If item not found:
```json
{
  "message": "Item not found"
}
```

## Project Structure

```
root/
├── functions/
│   └── items/
│       ├── index.js          # Lambda function handler
│       └── event.json        # Sample event for local testing
├── template.yaml              # SAM template defining AWS resources
├── package.json               # Node.js dependencies
└── README.md                  # This file
```

## Environment Variables

The Lambda function uses the following environment variables (automatically set by SAM):

- `TABLE_NAME`: DynamoDB table name (default: `ItemsTable`)
- `AWS_REGION`: AWS region (default: `us-west-2`)

## Error Handling

The API returns appropriate HTTP status codes:
- `200`: Success
- `400`: Unsupported HTTP method
- `500`: Internal server error

## Cleanup

To remove all AWS resources created by this application:

```bash
sam delete
```

