#!/bin/bash
# Bash script to create DynamoDB tables in AWS
# Make sure AWS CLI is configured first: aws configure

echo "Creating DynamoDB tables in AWS..."

# Create UsersTable
echo "Creating UsersTable..."
aws dynamodb create-table \
    --table-name UsersTable \
    --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=email,AttributeType=S \
    --key-schema AttributeName=userId,KeyType=HASH \
    --global-secondary-indexes IndexName=EmailIndex,KeySchema=[{AttributeName=email,KeyType=HASH}],Projection={ProjectionType=ALL} \
    --billing-mode PAY_PER_REQUEST \
    --region us-west-2

echo "Waiting for UsersTable to be active..."
aws dynamodb wait table-exists --table-name UsersTable --region us-west-2

echo "All tables created successfully!"

