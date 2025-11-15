# Amily API Test Script for PowerShell

Write-Host ""
Write-Host "Testing Amily Companion API" -ForegroundColor Cyan
Write-Host ""

# Test 1: Health Check
Write-Host "Test 1: Health Check" -ForegroundColor Green
$health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method GET
$health | ConvertTo-Json
Write-Host ""

# Test 2: Daily Check-in
Write-Host "Test 2: Daily Check-in" -ForegroundColor Green
$body2 = @{
    userId = "user123"
    userInput = "I am feeling okay today"
    mood = "ok"
} | ConvertTo-Json
$checkin = Invoke-RestMethod -Uri "http://localhost:3000/api/checkin" -Method POST -ContentType "application/json" -Body $body2
$checkin | ConvertTo-Json -Depth 5
Write-Host ""

# Test 3: Empathy Response
Write-Host "Test 3: Empathy Response" -ForegroundColor Green
$body3 = @{
    userInput = "I feel lonely today"
} | ConvertTo-Json
$empathy = Invoke-RestMethod -Uri "http://localhost:3000/api/empathy" -Method POST -ContentType "application/json" -Body $body3
$empathy | ConvertTo-Json -Depth 5
Write-Host ""

# Test 4: Memory Recording
Write-Host "Test 4: Memory Recording" -ForegroundColor Green
$body4 = @{
    userId = "user123"
    storyInput = "I remember climbing the old oak tree with my brother every summer. We would sit up there for hours."
} | ConvertTo-Json
$memory = Invoke-RestMethod -Uri "http://localhost:3000/api/memory" -Method POST -ContentType "application/json" -Body $body4
$memory | ConvertTo-Json -Depth 5
Write-Host ""

# Test 5: Buddy Message
Write-Host "Test 5: Buddy Message" -ForegroundColor Green
$body5 = @{
    userId = "user123"
    messageFrom = "Sarah"
    messageText = "Hi Mom, thinking of you today! Hope you are doing well."
} | ConvertTo-Json
$buddy = Invoke-RestMethod -Uri "http://localhost:3000/api/buddy" -Method POST -ContentType "application/json" -Body $body5
$buddy | ConvertTo-Json -Depth 5
Write-Host ""

# Test 6: User Preferences
Write-Host "Test 6: User Preferences" -ForegroundColor Green
$prefs = Invoke-RestMethod -Uri "http://localhost:3000/api/preferences/user123" -Method GET
$prefs | ConvertTo-Json -Depth 5
Write-Host ""

Write-Host "All API tests completed!" -ForegroundColor Cyan
Write-Host ""
