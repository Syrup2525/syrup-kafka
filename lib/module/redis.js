const redis = require('redis')

/**
 * @typedef  {Object}   ConsumerInfo                토픽을 구독중인 컨슈머 정보
 * @property {number[]} ConsumerInfo.partitions     소비할 파티션 배열    
 * @property {string}   ConsumerInfo.groupId        컨슈머 그룹 id
 * @property {string}   ConsumerInfo.memberId
 * @property {string}   ConsumerInfo.leaderId       컨슈머 그룹 리더 id
 * @property {boolean}  ConsumerInfo.isLeader       리더 파티션 여부
 * @property {string}   ConsumerInfo.groupProtocol
 */

/**
 * Redis 접속 정보
 * @typedef  {Object} RedisConfig
 * @property {string} RedisConfig.host     접속 호스트
 * @property {number} RedisConfig.port     접속 포트
 * @property {number} RedisConfig.dbNumber 접속 DB 번호
 * @property {string} RedisConfig.username 유저 이름
 * @property {string} RedisConfig.password 유저 이름
 * @property {string} RedisConfig.key      클라이언트 정보가 저장될 KEY 이름
 */

/**
 * @type { import('redis').RedisClientType }
 */
let client = null

/**
 * @type {string}
 */
let KEY = null

/**
 * 레디스 초기화
 * @param {RedisConfig} config 
 */
const init = async (config) => {
    try {
        client = redis.createClient({
            url: `redis://${config.host}:${config.port}`,
            username: config.username,
            password: config.password,
        })
    
        client.on("error", (err) => {
            throw err
        })

        KEY = config.key
    
        await client.connect()
        await client.select(config.dbNumber)
    } catch (err) {
        throw `redis init error: ${err.toString()}`
    }
}

/**
 * 컨슈머 정보 삭제 
 * @param {string} clientId 
 * @param {string} groupId
 */
const hDel = async (clientId, groupId) => {
    if (client === null) {
        throw "init function call must precede."
    }

    try {
        const clientValue = JSON.parse(await client.hGet(KEY, clientId))

        for (const key in clientValue) {
            if (clientValue[key].groupId === groupId) {
                delete clientValue[key]
            }
        }

        if (Object.keys(clientValue).length === 0) {
            await client.hDel(KEY, clientId)
        } else {
            await client.hSet(KEY, clientId, JSON.stringify(clientValue))
        }
    } catch (err) {
        throw `redis del error: ${err.toString()}`
    }
}

/**
 * 컨슈머 정보 저장
 * @param {string} clientId 컨슈머 client id
 * @param {Object<string, ConsumerInfo>} consumerInfo 컨슈머 정보 (key: topic, value: consumerInfo)
 */
const hSet = async (clientId, consumerInfo) => {
    if (client === null) {
        throw "init function call must precede."
    }

    try {
        const exists = await client.hExists(KEY, clientId)

        let clientValue = {}

        if (Boolean(exists)) {
            clientValue = JSON.parse(await client.hGet(KEY, clientId))
        }

        for (const key in consumerInfo) {
            clientValue[key] = consumerInfo[key]
        }

        await client.hSet(KEY, clientId, JSON.stringify(clientValue))
    } catch (err) {
        throw `redis hSet error: ${err.toString()}`
    }
}

/**
 * 컨슈머 정보 가져오기
 * @param {string} clientId 컨슈머 client id
 * @returns {Promise<Object<String, ConsumerInfo>>}
 */
const hGet = async (clientId) => {
    if (client === null) {
        throw "init function call must precede."
    }

    try {
        return JSON.parse(await client.hGet(KEY, clientId))
    } catch (err) {
        throw `redis hGet error: ${err.toString()}`
    }
}

const quit = async () => {
    if (client && client.isOpen) {
        await client.quit()
    }
}

module.exports = {
    init,
    quit,
    hGet,
    hSet,
    hDel,
}