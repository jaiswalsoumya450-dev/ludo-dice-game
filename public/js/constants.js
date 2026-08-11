const API_BASE_URL = 'http://127.0.0.1:3001';

const port = 3001;

const CODE_VERSION = 'v1';

const ipAddress = '127.0.0.1';

const SOCKET_BASE_URL = {
    'local': 'http://192.168.1.192:3001',
    'dev': 'https://dev-main.ludokingapi.com'
}[NODE_ENV];

const SOCKET_PATH = {
    'local': '/v7/socket.io',
    'dev': '/v7/socket.io'
}[NODE_ENV];