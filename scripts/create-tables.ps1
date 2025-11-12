# PowerShell script to create DynamoDB tables in AWS
# Make sure AWS CLI is configured first: aws configure

Write-Host "Creating DynamoDB tables in AWS..." -ForegroundColor Green

# Create UsersTable
Write-Host "Creating UsersTable..." -ForegroundColor Yellow

# Read the GSI JSON from file and escape it properly for PowerShell
$gsiFile = Join-Path $PWD "gsi.json"
if (-not (Test-Path $gsiFile)) {
    Write-Host "Error: gsi.json not found. Please ensure it exists in the backend directory." -ForegroundColor Red
    exit 1
}

# Read raw content and ensure it's treated as a literal string
$gsiJson = [System.IO.File]::ReadAllText($gsiFile).Trim()

# Create table with GSI - use file:// reference which is more reliable
$absolutePath = (Resolve-Path $gsiFile).Path.Replace('\', '/')
# Convert Windows path to Unix-style for file://
if ($absolutePath -match '^([A-Z]):') {
    $absolutePath = "/$($matches[1].ToLower())/$($absolutePath.Substring(3))"
}

Write-Host "Creating table with GSI from file..." -ForegroundColor Cyan
aws dynamodb create-table `
    --table-name UsersTable `
    --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=email,AttributeType=S `
    --key-schema AttributeName=userId,KeyType=HASH `
    --global-secondary-indexes "file://$absolutePath" `
    --billing-mode PAY_PER_REQUEST `
    --region us-west-2

Write-Host "Waiting for UsersTable to be active..." -ForegroundColor Yellow
aws dynamodb wait table-exists --table-name UsersTable --region us-west-2

Write-Host "All tables created successfully!" -ForegroundColor Green

