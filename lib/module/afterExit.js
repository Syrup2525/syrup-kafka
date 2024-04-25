const redis = require('./redis.js')

/**
 * @typedef  {Object} RedisConfig          Redis 연결 정보
 * @property {string} RedisConfig.host     접속 호스트
 * @property {number} RedisConfig.port     접속 포트
 * @property {number} RedisConfig.dbNumber 접속 DB 번호
 * @property {string} RedisConfig.key      클라이언트 정보가 저장될 KEY 이름
 */

/**
 * @typedef  {Object}   ConsumerInfo          삭제할 컨슈머 정보
 * @property {string}   ConsumerInfo.clientId 삭제할 클라이언트 id 
 * @property {string[]} ConsumerInfo.groupIds 삭제할 그룹 id 리스트
 */

/**
 * @typedef  {Object}       ExitInfo              종료 정보
 * @property {RedisConfig}  ExitInfo.redisConfig  Redis 연결 정보 
 * @property {ConsumerInfo} ExitInfo.consumerInfo 삭제할 컨슈머 정보
 */

const deleteConsumerInfo = async () => {
    /**
     * @type {ExitInfo}
     */
    const exitInfo = JSON.parse(process.argv[2])

    await redis.init({
        host: exitInfo.redisConfig.host,
        port: exitInfo.redisConfig.port,
        dbNumber: exitInfo.redisConfig.dbNumber,
        key: exitInfo.redisConfig.key
    })

    for (const groupid of exitInfo.consumerInfo.groupIds) {
        await redis.hDel(exitInfo.consumerInfo.clientId, groupid)
    }

    await redis.quit()

    process.exit(0)
}

deleteConsumerInfo()