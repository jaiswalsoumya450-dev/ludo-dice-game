# practice

A small multiplayer dice game. Players log in as guests, put chips on the table, and take turns rolling a die. The first player to reach 100 points takes the whole pot.

The backend is Express and Socket.IO. Player accounts and chip balances live in MongoDB, and everything about live games (rooms, matchmaking, turns) lives in Redis, so a game survives a server restart and can be shared across several server instances.

## How a game works

- Every new account starts with 5000 chips.
- From the main screen you pick a table size (2 to 4 players) and a stake (0 to 1000 chips), then join a public game or create a private one.
- Your stake is taken when you join. If you leave before the game starts, you get it back.
- The game starts as soon as the table is full. Players roll in the order they joined.
- Each roll (1 to 6) is added to your score. Scores are capped at 100, and whoever gets there first wins everyone's stake.
- Leaving a game in progress counts as a forfeit and the other player gets the pot. In 3 and 4 player games it goes to the first remaining player in turn order.
- A waiting room that doesn't fill within 30 seconds is cancelled and everyone in it gets their stake back.
- A game where nobody rolls for 2 minutes is called off as a draw and everyone is refunded.

## Stack

- Node.js (developed on Node 24; Express 5 needs at least 18)
- Express 5, express-validator, JWT for the REST API
- Socket.IO 4 for everything in-game
- MongoDB through Mongoose for users and chips
- Redis through ioredis for rooms, matchmaking and locks
- EJS pages with jQuery and Tailwind (loaded from a CDN) for the frontend
- log4js for logging, Jest and Supertest for tests

## Running it locally

You need MongoDB and Redis running. Redis is expected at `127.0.0.1:6379`; that address is hard-coded in `utils/redis/connections.js`.

Create a `.env` file in the project root:

```
NODE_ENV=local
PORT=3001
LOCAL_IP=127.0.0.1
CODE_VERSION=v1
MONGO_DB_URL=mongodb://127.0.0.1:27017/practice
JWT_SECRET=pick-something-long-and-random
```

Then:

```
npm install
npm start
```

Open http://127.0.0.1:3001/web/login. To try a 2-player game on one machine, log in with two different device IDs in two browsers (or one normal window and one private window).

Keep `PORT=3001` and `CODE_VERSION=v1` unless you also change the frontend. The browser code has `http://127.0.0.1:3001` and `v1` baked into `public/js/constants.js`, and the views load the Socket.IO client from `/v1/socket.io/socket.io.js`.

If `JWT_SECRET` isn't set, the server falls back to `dev_secret_change_in_prod`. That's fine on your own machine, but don't deploy without setting it.

`NODE_ENV` only picks the log4js category (`prod`, `staging`, `dev` or `local`). They all log at trace level to stdout.

## Project layout

```
index.js                     entry point: loads .env, sets up globals, starts the server
config/
  app.config.js              Express middleware, routes and the error handler
  logger.config.js           log4js setup
constants/app.constants.js   values read from the environment
modules/start.server.js      creates the HTTP server, attaches Socket.IO, connects to Mongo, listens
routes/                      /api/v1/auth, /api/v1/user and the /web pages
middleware/
  auth.js                    checks the Bearer token and sets req.user
  validator.js               request body validation (failures return 412)
controllers/                 REST handlers, plus the EJS page renderers in web.controllers.js
models/user.model.js         the User schema (did, sName, sImage, chips)
services/
  auth.services.js           guest login: find or create a user by device ID
  user.services.js           profile read/update/delete and the Redis user cache
  game.services.js           all game rules and room storage (the core of the project)
  wallet.services.js         atomic chip debits and credits
  payout.services.js         pays the pot to the winner, or refunds everyone on a draw
socket/
  socket.init.js             creates the Socket.IO server
  socket.connection.js       token check on connect, event routing, reconnect grace period
  socket.events.js           event names
  controllers/
    join.controller.js       join, rejoin and leave rooms, plus the background sweeps
    gameplay.controller.js   rejoin a game and roll the dice
utils/
  redis/                     connection, key names, command helpers, small schemas
  mongodb/connection.js      Mongo connection
  httpResponse.js            412 and 400 helpers
public/
  views/                     login, main, search (waiting room) and gameplay pages
  js/                        the browser code for those pages
tests/                       see Tests below
```

## How it fits together

### Logging in

There's no password. You enter a device ID and a name. If that device ID already has an account you get it back (renamed if you typed a different name), otherwise a new one is created. The response includes a JWT valid for 7 days, which the browser keeps in `localStorage` and sends with every API call and socket connection.

The device ID works as the only credential, so the profile endpoints only ever show you your own account.

### Moving between screens

The app goes login, then main, then search (the waiting room), then gameplay, and each step is a full page load. That means every screen change drops the socket and opens a new one. If a socket in a room disconnects, the server waits 5 seconds before treating it as a real leave, and a reconnect from the same user inside that window cancels it. Each page re-attaches itself to the game with `rejoinRoom` or `rejoinGame`.

### Matchmaking

Open public rooms are kept in a Redis set per table size and stake (`open_rooms:Public:<maxPlayers>:<stake>`), so you only get matched with people looking for the same game. Joining picks a random open room from your bucket. If that room has disappeared or already started in the meantime, it's dropped from the set and another is tried. After 5 misses a new room is created. When a room fills up it's removed from the set and the game starts.

Private rooms are never listed, so at the moment nobody else can join one.

### Chips

Balances live only in MongoDB and only change through `wallet.services.js`. A debit is a single conditional update (`chips >= amount`), so two joins at once can never take a balance below zero. Stakes are taken on join, refunded if you leave before the game starts, and paid out by `payout.services.js` when a game finishes. The profile `PUT` endpoint can't touch chips.

### Concurrency

A room is stored as one JSON string at `{gameId}:game`. Every change (a join, a roll, a leave, a forfeit) reads it, applies the change in a plain function, and writes it back through a small Lua compare-and-set script. If someone else wrote first, it re-reads and tries again, up to 8 times, before giving up with a 409. This is what stops two server instances from both applying a roll to the same old copy of a room.

Joins also take a 5-second per-user lock in Redis. A second join from the same user while the first is still running gets a 429, so double-clicking Play can't charge you twice.

When a player leaves a waiting room, the refund is based on the write that actually took them out of the room, not on an earlier read. If several leaves for the same player arrive at once, only one of them can see the player in the room, so only one refund goes out.

Two background jobs run every 3 seconds on every server instance: one cancels waiting rooms whose 30 seconds are up, the other calls off games with no roll for 2 minutes. Each due room is claimed with a `ZREM`, so only one instance handles it. Cancelling also goes through the compare-and-set, so a player who joins or leaves at the same moment is either fully in (the game starts, or they're refunded with the room) or fully out (their own leave refunded them).

The game rules (`fnAddPlayerPure`, `fnRollDicePure`, `fnForfeitPure` and so on in `game.services.js`) are plain functions with no I/O, which makes them easy to test on their own.

## REST API

All routes are under `/api/v1`. The user routes need `Authorization: Bearer <token>`.

| Method | Path | Body | What it does |
|---|---|---|---|
| POST | `/auth/guest` | `{ did, sName }` | Logs in or signs up. Returns `{ success, token, _id, sName, did, chips }`. |
| GET | `/user/:id` | | Your profile. Any id other than your own gets a 403. |
| PUT | `/user` | `{ sName?, sImage? }` | Updates your profile. The account comes from the token; `_id` and `chips` in the body are ignored. |
| DELETE | `/user/:id` | | Deletes your account. Any id other than your own gets a 403. |

Status codes: 400 for malformed JSON or a database/validation error, 401 for a missing or bad token, 403 for someone else's account, 404 when the user doesn't exist, 412 when request validation fails, and 413 when the body is over 1 MB or has more than 500 form fields.

The pages are served at `/web/login`, `/web/main`, `/web/search` and `/web/gameplay`. Everything in `public/` is also served as static files.

## Socket API

Connect to the same host with path `/v1/socket.io` and pass the JWT as `auth: { token }` (a `?token=` query parameter also works). Connections without a valid token are rejected with `Unauthorized`.

Every client event takes a payload and an acknowledgement callback. Acks always include `status`, plus `message` when something went wrong.

### Client to server

| Event | Payload | Ack on success |
|---|---|---|
| `joinPublicGame` | `{ maxPlayers, lobbyChips }` | `{ status: 200, ...room }` |
| `joinPrivateGame` | `{ maxPlayers, lobbyChips }` | `{ status: 200, ...room }` |
| `rejoinRoom` | `{ gameId }` | `{ status: 200, ...room }` |
| `rejoinGame` | `{ gameId }` | `{ status: 200, ...game }` |
| `rollDice` | `{ gameId }` | `{ status: 200, roll, ...game }` |
| `leaveRoom` | `{ gameId }` | `{ status: 200 }` |

`maxPlayers` is clamped to 2 to 4 (default 2) and `lobbyChips` defaults to 0. Who you are always comes from the token, never from the payload. If `gameId` is left out of `rejoinGame`, `rollDice` or `leaveRoom`, the room this socket last joined is used.

`room` is `{ gameId, eRoomMode, maxPlayers, roomStatus, expiresAt, players: [{ userId, sName, sImage }] }`.

`game` is `{ gameId, eRoomMode, maxPlayers, roomStatus, target, turnUserId, winnerId, abandoned, players: [{ userId, sName, sImage, score }] }`.

Error statuses: 400 for game rule violations ("It's not your turn.", "Not enough chips.", "This game has already started."), 404 when the game is gone or you're not in it, 409 when the room was too busy to update, 429 when a join is already in progress, and 500 for anything unexpected.

### Server to client

These are sent to everyone in the room.

| Event | Payload | When |
|---|---|---|
| `roomUpdate` | `room` | Someone joined or left a waiting room |
| `roomStarting` | `game` | The room filled up and the game started |
| `diceRolled` | `{ roll, ...game }` | After every roll. `roll` is `null` when the game ended by forfeit or was abandoned. |
| `roomCancelled` | `{ message }` | A waiting room timed out |

## Redis keys

| Key | Type | Holds |
|---|---|---|
| `{gameId}:game` | string | The room as JSON. Gets a 1-hour TTL after its first update. |
| `{userId}:active_game` | string | The gameId the player is currently in |
| `{userId}:join_lock` | string | Join lock, 5-second TTL |
| `open_rooms:Public:<size>:<stake>` | set | Public rooms that still have seats |
| `waiting_rooms_expiry` | sorted set | gameId scored by when its 30-second wait runs out |
| `active_games_activity` | sorted set | gameId scored by the time of the last roll |
| `user:<userId>` | hash | Cached user profile, 7-day TTL |

The curly braces are Redis Cluster hash tags. They keep each player's keys on the same shard.

## Tests

```
npm test                 # everything
npm run test:coverage    # with a coverage report in coverage/
npx jest tests/unit/services/game.redis.test.js   # a single file
```

The tests don't need MongoDB or Redis. `tests/helpers` has an in-memory Redis (including the compare-and-set script) and an in-memory User model, and `tests/setup/globals.js` makes sure no test ever opens a real Redis connection.

- `tests/unit/` has one file per module.
- `tests/integration/http.test.js` runs the real Express app through Supertest.
- `tests/integration/game.flow.test.js` plays real games through the socket controllers, game service, wallet and payout, and checks that chips are never created or lost. It includes a random-play test. The default run uses 4 seeds; for a longer run use `FUZZ_SEEDS=300 npx jest tests/integration/game.flow -t "random play"` (on PowerShell, `$env:FUZZ_SEEDS=300; npx jest ...`).

Bugs that are known but not fixed yet are written as `test.failing`. Each one describes the correct behaviour, so it currently fails and Jest counts it as a pass. When you fix one, Jest reports that test as failing because it now passes. Change it to a normal `test` at that point.

## Known issues

These are open. Most have a `test.failing` test that covers them.

- Double charge. If you're still seated in a waiting public room but your active-game pointer moved (by joining and then leaving a private room), joining public again charges you a second time without giving you a second seat.
- Negative stakes. The server accepts a negative `lobbyChips`. The browser blocks it, but a hand-made socket message doesn't have to. The winner ends up losing chips at payout.
- Fractional table sizes. `maxPlayers: 3.5` isn't rounded.
- Rejoin errors hang the client. `rejoinRoom` and `rejoinGame` have no try/catch, so a Redis error means the ack is never sent.
- Under heavy write contention a perfectly good room can be dropped from the open list.
- New rooms are saved without a TTL until their first update.
- Private rooms can't be joined by anyone else, since there's no join-by-code yet.
- In 3 and 4 player games, one player leaving ends the game for everyone.
- The Redis host and the frontend URLs are hard-coded (see Running it locally).
- The `user:<id>` cache isn't refreshed when a profile is updated.
- `controllers/socket.controllers.js` is leftover code that uses `import` in a CommonJS project and would crash if loaded. `public/js/socket.js` isn't loaded by any page, and `_fnInitGlobal` in `modules/start.server.js` is never called.
- `node_modules` is committed to git. Adding it to `.gitignore` and running `git rm -r --cached node_modules` would clean that up.
