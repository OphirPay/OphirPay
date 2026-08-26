# Solution for #214: API cookbook: curl + response example for every public endpoint

# API Cookbook

This document provides `curl` examples and sample responses for every public endpoint in the API. All examples use realistic data and include required authentication headers.

**Base URL**: `https://api.example.com/v1`  
**Authentication**: Bearer token (JWT) – replace `$TOKEN` with a valid access token.

---

## Authentication

All endpoints except `/auth/login` and `/auth/refresh` require a valid Bearer token.

```bash
export TOKEN="your-jwt-token"
```

---

## Endpoints

### 1. Authentication

#### 1.1. Login

**Request**
```bash
curl -X POST https://api.example.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "SecurePass123!"
  }'
```

**Response** (200 OK)
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Error** (401 Unauthorized)
```json
{
  "error": "Invalid credentials"
}
```

#### 1.2. Refresh Token

**Request**
```bash
curl -X POST https://api.example.com/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

**Response** (200 OK)
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

---

### 2. Users

#### 2.1. List Users

**Request**
```bash
curl -X GET https://api.example.com/v1/users?limit=10&offset=0 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** (200 OK)
```json
{
  "data": [
    {
      "id": "usr_123",
      "email": "alice@example.com",
      "full_name": "Alice Johnson",
      "role": "admin",
      "created_at": "2025-01-15T10:30:00Z",
      "updated_at": "2025-03-20T14:22:00Z"
    },
    {
      "id": "usr_456",
      "email": "bob@example.com",
      "full_name": "Bob Smith",
      "role": "user",
      "created_at": "2025-02-01T08:15:00Z",
      "updated_at": "2025-03-18T09:45:00Z"
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 42,
    "next": "/v1/users?limit=10&offset=10"
  }
}
```

#### 2.2. Create User

**Request**
```bash
curl -X POST https://api.example.com/v1/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "charlie@example.com",
    "password": "TempPass456!",
    "full_name": "Charlie Brown",
    "role": "user"
  }'
```

**Response** (201 Created)
```json
{
  "id": "usr_789",
  "email": "charlie@example.com",
  "full_name": "Charlie Brown",
  "role": "user",
  "created_at": "2026-08-26T09:00:00Z",
  "updated_at": "2026-08-26T09:00:00Z"
}
```

**Error** (409 Conflict)
```json
{
  "error": "User with email 'charlie@example.com' already exists"
}
```

#### 2.3. Get User by ID

**Request**
```bash
curl -X GET https://api.example.com/v1/users/usr_123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** (200 OK)
```json
{
  "id": "usr_123",
  "email": "alice@example.com",
  "full_name": "Alice Johnson",
  "role": "admin",
  "created_at": "2025-01-15T10:30:00Z",
  "updated_at": "2025-03-20T14:22:00Z"
}
```

**Error** (404 Not Found)
```json
{
  "error": "User not found"
}
```

#### 2.4. Update User

**Request**
```bash
curl -X PATCH https://api.example.com/v1/users/usr_123 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Alice J. Johnson",
    "role": "editor"
  }'
```

**Response** (200 OK)
```json
{
  "id": "usr_123",
  "email": "alice@example.com",
  "full_name": "Alice J. Johnson",
  "role": "editor",
  "created_at": "2025-01-15T10:30:00Z",
  "updated_at": "2026-08-26T09:15:00Z"
}
```

#### 2.5. Delete User

**Request**
```bash
curl -X DELETE https://api.example.com/v1/users/usr_789 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** (204 No Content) – no response body.

**Error** (403 Forbidden)
```json
{
  "error": "Cannot delete a user with admin role"
}
```

---

### 3. Posts

#### 3.1. List Posts

**Request**
```bash
curl -X GET https://api.example.com/v1/posts?status=published&limit=5 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** (200 OK)
```json
{
  "data": [
    {
      "id": "pst_001",
      "title": "Getting Started with Our API",
      "content": "This post explains how to integrate...",
      "author_id": "usr_123",
      "status": "published",
      "created_at": "2026-08-20T12:00:00Z",
      "updated_at": "2026-08-21T08:30:00Z"
    },
    {
      "id": "pst_002",
      "title": "Advanced Error Handling",
      "content": "Learn how to handle various error codes...",
      "author_id": "usr_456",
      "status": "published",
      "created_at": "2026-08-22T14:20:00Z",
      "updated_at": "2026-08-23T10:10:00Z"
    }
  ],
  "pagination": {
    "limit": 5,
    "offset": 0,
    "total": 12,
    "next": "/v1/posts?status=published&limit=5&offset=5"
  }
}
```

#### 3.2. Create Post

**Request**
```bash
curl -X POST https://api.example.com/v1/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "New Feature Announcement",
    "content": "We are excited to introduce...",
    "status": "draft"
  }'
```

**Response** (201 Created)
```json
{
  "id": "pst_003",
  "title": "New Feature Announcement",
  "content": "We are excited to introduce...",
  "author_id": "usr_123",
  "status": "draft",
  "created_at": "2026-08-26T09:30:00Z",
  "updated_at": "2026-08-26T09:30:00Z"
}
```

#### 3.3. Get Post by ID

**Request**
```bash
curl -X GET https://api.example.com/v1/posts/pst_001 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** (200 OK)
```json
{
  "id": "pst_001",
  "title": "Getting Started with Our API",
  "content": "This post explains how to integrate...",
  "author_id": "usr_123",
  "status": "published",
  "created_at": "2026-08-20T12:00:00Z",
  "updated_at": "2026-08-21T08:30:00Z"
}
```

#### 3.4. Update Post

**Request**
```bash
curl -X PATCH https://api.example.com/v1/posts/pst_003 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "published"
  }'
```

**Response** (200 OK)
```json
{
  "id": "pst_003",
  "title": "New Feature Announcement",
  "content": "We are excited to introduce...",
  "author_id": "usr_123",
  "status": "published",
  "created_at": "2026-08-26T09:30:00Z",
  "updated_at": "2026-08-26T09:45:00Z"
}
```

#### 3.5. Delete Post

**Request**
```bash
curl -X DELETE https://api.example.com/v1/posts/pst_003 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** (204 No Content)

---

### 4. Comments

#### 4.1. List Comments on a Post

**Request**
```bash
curl -X GET https://api.example.com/v1/posts/pst_001/comments?limit=3 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** (200 OK)
```json
{
  "data": [
    {
      "id": "cmt_101",
      "post_id": "pst_001",
      "author_id": "usr_456",
      "content": "Great guide, very helpful!",
      "created_at": "2026-08-21T09:00:00Z"
    },
    {
      "id": "cmt_102",
      "post_id": "pst_001",
      "author_id": "usr_789",
      "content": "I have a question about authentication.",
      "created_at": "2026-08-22T16:20:00Z"
    }
  ],
  "pagination": {
    "limit": 3,
    "offset": 0,
    "total": 5,
    "next": "/v1/posts/pst_001/comments?limit=3&offset=3"
  }
}
```

#### 4.2. Create Comment

**Request**
```bash
curl -X POST https://api.example.com/v1/posts/pst_001/comments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Thanks for the detailed walkthrough!"
  }'
```

**Response** (201 Created)
```json
{
  "id": "cmt_103",
  "post_id": "pst_001",
  "author_id": "usr_123",
  "content": "Thanks for the detailed walkthrough!",
  "created_at": "2026-08-26T10:00:00Z"
}
```

#### 4.3. Delete Comment

**Request**
```bash
curl -X DELETE https://api.example.com/v1/comments/cmt_102 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** (204 No Content)

---

### 5. Health Check

**Request**
```bash
curl -X GET https://api.example.com/v1/health
```

**Response** (200 OK)
```json
{
  "status": "ok",
  "timestamp": "2026-08-26T10:05:00Z",
  "version": "1.2.0"
}
```

---

## Notes

- All timestamps are in ISO 8601 UTC.
- Pagination uses `limit` and `offset`; default `limit=20`.
- Rate limiting: 100 requests per minute per IP (public endpoints) and 1000 per minute for authenticated endpoints.
- For endpoints requiring a body, `Content-Type: application/json` is mandatory.
- Error responses follow the format: `{ "error": "<message>" }` with appropriate HTTP status codes.

For additional details, refer to the OpenAPI specification (`openapi.yaml`).

---
_Generated by DevilX BountyHub solver_
