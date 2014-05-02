# HTTP Configuration

HTTP configuration is different from normal configuration (located at `config.js`) since it has to be easily readable
by a computer it's in JSON format.

It contains the following:

## Twitter API details

```json
    "consumer_key": "...",
    "consumer_secret": "...",
    "access_token": "...",
    "access_token_secret": "...",
```

## Keyword to track
Can be a hashtag or just an ordinary keyword

```json
    "track_keyword": "#puffin",
```

## Camera connection details
All the URL info and HTTP auth info if required

```json
    "snapshot_url": "/file.jpg",
    "endpoint_url": "example.com:80",
    "use_http_auth": true,
    "http_username": "bob",
    "http_password": "password",
```

## Timer settings
How long to wait before requesting a new image and timeout for the request. Both in ms

```json
    "endpoint_recovery_time": 10000,
    "endpoint_timeout": 30000,
```

## Response settings
Should the response be a Twitter response (currently broken, for no apparent reason) and the response template.
The `$handle` in the response template will be automatically replaced with the screen name.

```json
    "set_reply_id": false,
    "response_template": "Hi @$handle. Here's your photo!",
```
