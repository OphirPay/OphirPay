# Solution for #214: API cookbook: curl + response example for every public endpoint

# API Cookbook

This document provides `curl` examples and sample responses for every public endpoint in the API.

All authenticated endpoints require a Bearer token obtained via the login endpoint. Replace `{{baseUrl}}` with your actual API base URL and `{{token}}` with a valid JWT.

---

## Authentication

### Login

Obtain an access token.

**Endpoint:** `POST /auth/login`

**Request:**
```bash
curl -X POST "{{baseUrl}}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "SecurePass123"
  }'
```

**Sample Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFsaWNlIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### Register

Create a new user account.

**Endpoint:** `POST /auth/register`

**Request:**
```bash
curl -X POST "{{baseUrl}}/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bob Smith",
    "email": "bob@example.com",
    "password": "AnotherPass456"
  }'
```

**Sample Response:**
```json
{
  "id": "usr_abc123",
  "name": "Bob Smith",
  "email": "bob@example.com",
  "created_at": "2026-08-27T10:00:00Z"
}
```

---

## Users

### List Users

Retrieve a list of all users (admin only).

**Endpoint:** `GET /users`

**Request:**
```bash
curl -X GET "{{baseUrl}}/users" \
  -H "Authorization: Bearer {{token}}"
```

**Sample Response:**
```json
{
  "data": [
    {
      "id": "usr_001",
      "name": "Alice Johnson",
      "email": "alice@example.com",
      "role": "admin",
      "created_at": "2026-01-15T08:30:00Z"
    },
    {
      "id": "usr_002",
      "name": "Bob Smith",
      "email": "bob@example.com",
      "role": "user",
      "created_at": "2026-02-20T12:45:00Z"
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 10
}
```

### Get User by ID

Retrieve a specific user.

**Endpoint:** `GET /users/{id}`

**Request:**
```bash
curl -X GET "{{baseUrl}}/users/usr_001" \
  -H "Authorization: Bearer {{token}}"
```

**Sample Response:**
```json
{
  "id": "usr_001",
  "name": "Alice Johnson",
  "email": "alice@example.com",
  "role": "admin",
  "created_at": "2026-01-15T08:30:00Z"
}
```

### Update User

Update user details.

**Endpoint:** `PUT /users/{id}`

**Request:**
```bash
curl -X PUT "{{baseUrl}}/users/usr_001" \
  -H "Authorization: Bearer {{token}}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice J. Johnson",
    "role": "admin"
  }'
```

**Sample Response:**
```json
{
  "id": "usr_001",
  "name": "Alice J. Johnson",
  "email": "alice@example.com",
  "role": "admin",
  "updated_at": "2026-08-27T14:20:00Z"
}
```

### Delete User

Delete a user account.

**Endpoint:** `DELETE /users/{id}`

**Request:**
```bash
curl -X DELETE "{{baseUrl}}/users/usr_002" \
  -H "Authorization: Bearer {{token}}"
```

**Sample Response:**
```json
{
  "message": "User deleted successfully"
}
```

---

## Products

### List Products

Retrieve a paginated list of products.

**Endpoint:** `GET /products`

**Request:**
```bash
curl -X GET "{{baseUrl}}/products?page=1&limit=5&category=electronics" \
  -H "Authorization: Bearer {{token}}"
```

**Sample Response:**
```json
{
  "data": [
    {
      "id": "prd_101",
      "name": "Wireless Headphones",
      "description": "Noise-cancelling over-ear headphones",
      "price": 99.99,
      "category": "electronics",
      "stock": 45,
      "created_at": "2026-03-10T09:00:00Z"
    },
    {
      "id": "prd_102",
      "name": "Smart Watch",
      "description": "Fitness tracker with heart rate monitor",
      "price": 199.50,
      "category": "electronics",
      "stock": 12,
      "created_at": "2026-04-05T11:15:00Z"
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 5
}
```

### Create Product

Add a new product (admin only).

**Endpoint:** `POST /products`

**Request:**
```bash
curl -X POST "{{baseUrl}}/products" \
  -H "Authorization: Bearer {{token}}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bluetooth Speaker",
    "description": "Portable waterproof speaker",
    "price": 49.99,
    "category": "electronics",
    "stock": 100
  }'
```

**Sample Response:**
```json
{
  "id": "prd_103",
  "name": "Bluetooth Speaker",
  "description": "Portable waterproof speaker",
  "price": 49.99,
  "category": "electronics",
  "stock": 100,
  "created_at": "2026-08-27T15:30:00Z"
}
```

### Get Product by ID

Retrieve a single product.

**Endpoint:** `GET /products/{id}`

**Request:**
```bash
curl -X GET "{{baseUrl}}/products/prd_101" \
  -H "Authorization: Bearer {{token}}"
```

**Sample Response:**
```json
{
  "id": "prd_101",
  "name": "Wireless Headphones",
  "description": "Noise-cancelling over-ear headphones",
  "price": 99.99,
  "category": "electronics",
  "stock": 45,
  "created_at": "2026-03-10T09:00:00Z"
}
```

### Update Product

Update an existing product.

**Endpoint:** `PUT /products/{id}`

**Request:**
```bash
curl -X PUT "{{baseUrl}}/products/prd_101" \
  -H "Authorization: Bearer {{token}}" \
  -H "Content-Type: application/json" \
  -d '{
    "price": 89.99,
    "stock": 40
  }'
```

**Sample Response:**
```json
{
  "id": "prd_101",
  "name": "Wireless Headphones",
  "description": "Noise-cancelling over-ear headphones",
  "price": 89.99,
  "category": "electronics",
  "stock": 40,
  "updated_at": "2026-08-27T16:00:00Z"
}
```

### Delete Product

Remove a product.

**Endpoint:** `DELETE /products/{id}`

**Request:**
```bash
curl -X DELETE "{{baseUrl}}/products/prd_103" \
  -H "Authorization: Bearer {{token}}"
```

**Sample Response:**
```json
{
  "message": "Product deleted"
}
```

---

## Orders

### List Orders

Retrieve orders for the authenticated user (or all if admin).

**Endpoint:** `GET /orders`

**Request:**
```bash
curl -X GET "{{baseUrl}}/orders?status=processing" \
  -H "Authorization: Bearer {{token}}"
```

**Sample Response:**
```json
{
  "data": [
    {
      "id": "ord_501",
      "user_id": "usr_002",
      "items": [
        {
          "product_id": "prd_102",
          "quantity": 2,
          "price": 199.50
        }
      ],
      "total": 399.00,
      "status": "processing",
      "created_at": "2026-08-26T18:20:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

### Create Order

Place a new order.

**Endpoint:** `POST /orders`

**Request:**
```bash
curl -X POST "{{baseUrl}}/orders" \
  -H "Authorization: Bearer {{token}}" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "product_id": "prd_101", "quantity": 1 },
      { "product_id": "prd_102", "quantity": 1 }
    ]
  }'
```

**Sample Response:**
```json
{
  "id": "ord_502",
  "user_id": "usr_002",
  "items": [
    {
      "product_id": "prd_101",
      "quantity": 1,
      "price": 89.99
    },
    {
      "product_id": "prd_102",
      "quantity": 1,
      "price": 199.50
    }
  ],
  "total": 289.49,
  "status": "pending",
  "created_at": "2026-08-27T17:00:00Z"
}
```

### Get Order by ID

Retrieve a specific order.

**Endpoint:** `GET /orders/{id}`

**Request:**
```bash
curl -X GET "{{baseUrl}}/orders/ord_501" \
  -H "Authorization: Bearer {{token}}"
```

**Sample Response:**
```json
{
  "id": "ord_501",
  "user_id": "usr_002",
  "items": [
    {
      "product_id": "prd_102",
      "quantity": 2,
      "price": 199.50
    }
  ],
  "total": 399.00,
  "status": "processing",
  "created_at": "2026-08-26T18:20:00Z",
  "updated_at": "2026-08-27T09:00:00Z"
}
```

### Update Order Status

Update an order's status (admin only).

**Endpoint:** `PATCH /orders/{id}/status`

**Request:**
```bash
curl -X PATCH "{{baseUrl}}/orders/ord_501/status" \
  -H "Authorization: Bearer {{token}}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "shipped"
  }'
```

**Sample Response:**
```json
{
  "id": "ord_501",
  "status": "shipped",
  "updated_at": "2026-08-27T17:30:00Z"
}
```

### Cancel Order

Cancel an order.

**Endpoint:** `DELETE /orders/{id}`

**Request:**
```bash
curl -X DELETE "{{baseUrl}}/orders/ord_502" \
  -H "Authorization: Bearer {{token}}"
```

**Sample Response:**
```json
{
  "message": "Order cancelled"
}
```

---

## Error Responses

For all endpoints, errors follow a consistent format:

**Sample Error (400 Bad Request):**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "email": "must be a valid email address"
    }
  }
}
```

**Sample Error (401 Unauthorized):**
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid token"
  }
}
```

**Sample Error (404 Not Found):**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

---
_Generated by DevilX BountyHub solver_
