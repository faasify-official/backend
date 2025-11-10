const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-west-2";
const TABLE_NAME = process.env.TABLE_NAME || "ItemsTable";

const client = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  const method = event.httpMethod || "GET";
  let response;

  try {
    if (method === "POST") {
      const body = JSON.parse(event.body);
      const item = {
        id: body.id,
        name: body.name,
        createdAt: new Date().toISOString(),
      };

      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

      response = {
        statusCode: 200,
        body: JSON.stringify({ message: "Item added", item }),
      };
    } else if (method === "GET") {
      const id = event.queryStringParameters?.id;
      const data = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { id } }));

      response = {
        statusCode: 200,
        body: JSON.stringify(data.Item || { message: "Item not found" }),
      };
    } else {
      response = { statusCode: 400, body: JSON.stringify({ message: "Unsupported method" }) };
    }
  } catch (err) {
    console.error("Error:", err);
    response = { statusCode: 500, body: JSON.stringify({ message: err.message }) };
  }

  return response;
};
