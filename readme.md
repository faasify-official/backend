Configure AWS Account

Configure AWS CLI with your credentials:

aws configure


Enter:

AWS Access Key ID

AWS Secret Access Key

Default region (e.g., us-east-1)

Default output format (json)

Verify:

aws sts get-caller-identity

Create a Lambda Function

Create a new SAM application:

sam init


Choose 1 - AWS Quick Start Templates

Runtime: Node.js 20.x

Application template: Hello World Example

Project name: serverless-app

The folder structure:

serverless-app/
├── functions/
│   └── helloWorld/
│       ├── index.js
├── template.yaml
├── package.json
└── README.md


Example Lambda handler (functions/helloWorld/index.js):

exports.handler = async (event) => {
    const name = event.queryStringParameters?.name || "World";
    return {
        statusCode: 200,
        body: JSON.stringify({ message: `Hello, ${name}!` }),
    };
};

Run Lambda Locally

Build the project:

sam build


Invoke the function locally:

sam local invoke HelloWorldFunction -e event.json


Test as an API:

sam local start-api
curl "http://localhost:3000/hello?name=SAM"

Connect Lambda to DynamoDB

Install AWS SDK for Node.js:

npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb


Example code (functions/items/index.js):

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "ItemsTable";

const client = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  const method = event.httpMethod || "GET";
  if (method === "POST") {
    const body = JSON.parse(event.body);
    const item = { id: body.id, name: body.name, createdAt: new Date().toISOString() };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return { statusCode: 200, body: JSON.stringify({ message: "Item added", item }) };
  } else if (method === "GET") {
    const id = event.queryStringParameters?.id;
    const data = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { id } }));
    return { statusCode: 200, body: JSON.stringify(data.Item || { message: "Item not found" }) };
  } else {
    return { statusCode: 400, body: JSON.stringify({ message: "Unsupported method" }) };
  }
};

Deploy Lambda to AWS

Build:

sam build


Deploy:

sam deploy --guided


Provide stack name, region, and confirm permissions

SAM will create resources and outputs including API endpoint

Testing

Local test:

sam local invoke ItemsFunction -e functions/items/event.json


API test:

sam local start-api
curl -X POST http://localhost:3000/items -d '{"id":"1","name":"Book"}'
curl http://localhost:3000/items?id=1


AWS test (after deployment):

curl https://<api-id>.execute-api.us-east-1.amazonaws.com/Prod/items?id=1