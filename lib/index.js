const path = require('path')
const { 
    Kafka, logLevel, Assigner, Assignment, AssignerProtocol, LogEntry, ProducerRecord, ConsumerGroupJoinEvent,
    SASLOptions, Mechanism, ProducerConfig, Message, CompressionTypes, 
    PartitionAssigners: {roundRobin} } = require('kafkajs')
const redis = require('./module/redis.js')
const { RedisConfig } = require('./module/redis.js')

/**
 * @typedef  {Object} KafkaBroker
 * @property {string} KafkaBroker.host     kafka 서버 host
 * @property {string} KafkaBroker.port     kafka 서버 port
 */

/**
 * @typedef  {Object}                                         KafkaConfig          kafka 연결시 설정 객체
 * @property {string}                                         KafkaConfig.clientId clientId 및 groupId
 * @property {KafkaBroker[]}                                  KafkaConfig.brokers  kafka 서버 broker 목록
 * @property {import("node:tls").ConnectionOptions | boolean} KafkaConfig.ssl
 * @property {SASLOptions | Mechanism}                        KafkaConfig.sasl
 */

/** 
 * @typedef  {Object}   MessageSendInfo            메시지 전송 객체
 * @property {string}   MessageSendInfo.topic      메시지를 생성할 토픽 (NOT NULL)
 * @property {number[]} MessageSendInfo.partitions 파티션을 지정하여 전송, 전송할 파티션 배열 (NULL)
 * @property {string}   MessageSendInfo.arrival    받는측 클라이언트 id (NULL) 
 * @property {*}        MessageSendInfo.headers    전송할 메시지의 header 정보 (Object 형태) (NULL)
 * @property {string}   MessageSendInfo.key        전송할 메시지의 key (NULL) 
 * @property {*}        MessageSendInfo.value      전송할 메시지의 value (NOT NULL)
 */

/**
 * @typedef  {Object} MessageConsumeInfoHeader           컨슘된 메시지 객체 헤더 정보
 * @property {string} MessageConsumeInfoHeader.departure 메시지 출발지 client id
 * @property {string} MessageConsumeInfoHeader.arrival   메시지 도착지 client id
 */

/**
 * @typedef  {Object}                   MessageConsumeInfo         컨슘된 메시지 객체
 * @property {MessageConsumeInfoHeader} MessageConsumeInfo.headers
 * @property {string}                   MessageConsumeInfo.key
 * @property {string}                   MessageConsumeInfo.value
 */

/**
 * @typedef  {Object}           MessageSendOptions              메시지 전송 옵션
 * @property {-1 | 0 | 1}       MessageSendOptions.acks         ack 제어 값
 * @property {number}           MessageSendOptions.timeout      응답 대기 시간
 * @property {CompressionTypes} MessageSendOptions.compression  압축 코덱
 */

/**
 * @typedef  {Object}   Topic            ConsumerGroupItem.Topic 정보 
 * @property {string}   Topic.name       토픽 이름
 * @property {number[]} Topic.partitions 소비할 파티션 배열
 */

/**
 * @typedef  {Object}  ConsumerGroupItem                   컨슈머 그룹에서 소비할 토픽 정보
 * @property {boolean} ConsumerGroupItem.isAPartitionssign 파티션을 사용자가 지정하여 소비할지 여부
 * @property {string}  ConsumerGroupItem.fromBeginning     처음부터 소비할지 여부
 * @property {Topic[]} ConsumerGroupItem.topics            구독할 토픽 정보 배열
 */

/**
 * @typedef {Object<string, ConsumerGroupItem>} ConsumerGroup key: groupId, value: 컨슈머 그룹에서 소비할 토픽 정보
 */

/**
 * @typedef  {Object}                     Consumer               컨슈머 목록을 관리하기 위해 필요한 컨슈머 정보
 * @property {string[]}                   Consumer.topics        해당 컨슈머가 구독중인 토픽 목록
 * @property {string}                     Consumer.groupId       해당 컨슈머가 속한 그룹 id
 * @property {boolean}                    Consumer.fromBeginning 해당 컨슈머가 처음부터 메시지를 소비하는지에 대한 여부
 * @property {import('kafkajs').Consumer} Consumer.kafkaConsumer kafkajs consumer 객체
 */

/**
 * @enum {string}
 */
const CALLBACK_TYPE = {
    ERROR: "ERROR",                                     // 오류
    KAFKA_LOG: "KAFKA_LOG",                             // kafkajs 로그
    EACH_MESSAGE: "EACH_MESSAG",                        // 메시지 소비시
    JOIN_GROUP: "JOIN_GROUP",                           // 컨슈머 그룹 참가 성공시
    CONSUMERS_LOAD_COMPLETE: "CONSUMERS_LOAD_COMPLETE", // 모든 컨슈머 그룹 참가 성공시
}

const CUSTOM_GROUP_PROTOCOL = "custom-assigner"

/**
 * @type {import('kafkajs').Producer} kafka 프로듀서 객체
 */
let producer = null

/**
 * @type {string} kafka consumer 클라이언트 id
 */
let clientId = null

/**
 * @type {Kafka} kafka 객체 
 */
let kafka = null

/**
 * @type {Consumer[]} 컨슈머 배열
 */
let consumers = []

/**
 * @type {RedisConfig} 프로세스 종료시 kafka Consumer 정보 업데이트를 위한 연결 정보 
 */
let globalRedisConfig = null

/**
 * @type {ProducerConfig} kafka producer 생성 options
 */
let globalProducerConfig = null

const CALLBACK_EVENT = {
    /**
     * 오류 발생시 실행되는 함수 
     * @param {string} errorMessage 오류 메시지
     */
    error: (errorMessage) => {},
    /**
     * kafka 로그 출력시 실행되는 함수 
     * @param {logLevel} loglevel 로그 수준 
     * @param {LogEntry} entry 로그 객체
     */
    kafkaLog: (loglevel, entry) => {},
    /**
     * consumer 에서 메시지 컨슘시 실행되는 함수
     * @param {string}             topic 수신된 토픽 이름
     * @param {number}             partition 수신된 파티션 번호
     * @param {MessageConsumeInfo} message 컨슘된 메시지
     */
    eachMessage: async (topic, partition, message) => {},
    /**
     * 컨슈머 그룹 참가시 실행되는 함수
     * @param {ConsumerGroupJoinEvent} 컨슈머 그룹에 참가한 컨슈머에 대한 정보
     */
    joinGroup: async (payload) => {},
    /**
     * 모든 컨슈머가 컨슈머 그룹 참가시 실행되는 함수
     * @param {Consumer[]} consumers 컨슈머 정보를 담고있는 배열
     */
    consumerLoadComplete: async (consumers) => {},
}

/**
 * 이벤트 콜백 함수 등록
 * @param {CALLBACK_TYPE} callbackType callback 구분
 * @param {(errorMessage: string) => void
 *      | (loglevel: logLevel, entry: import('kafkajs').LogEntry) => void
 *      | (consumeMessage: string) => Promise<void>
 *      | (payload: ConsumerGroupJoinEvent) => Promise<void>
 *      | (consumers: Consumer[]) => Promise<Void>} callback 콜백 함수
 */
const on = (callbackType, callback) => {
    switch (callbackType) {
        case CALLBACK_TYPE.ERROR:
            CALLBACK_EVENT.error = callback
            break;

        case CALLBACK_TYPE.KAFKA_LOG:
            CALLBACK_EVENT.kafkaLog = callback
            break;

        case CALLBACK_TYPE.EACH_MESSAGE:
            CALLBACK_EVENT.eachMessage = callback
            break;

        case CALLBACK_TYPE.JOIN_GROUP:
            CALLBACK_EVENT.joinGroup = callback
            break;

        case CALLBACK_TYPE.CONSUMERS_LOAD_COMPLETE:
            CALLBACK_EVENT.consumerLoadComplete = callback
            break;
    }
}

/**
 * Redis, Kafka 접속 설정
 * @param {RedisConfig}    redisConfig 
 * @param {KafkaConfig}    kafkaConfig 
 * @param {ProducerConfig} producerConfig
 */
const init = async (redisConfig, kafkaConfig, producerConfig) => {
    /* init redis */
    redisConfig = redisConfig || {}
    redisConfig.host = redisConfig.host || "localhost"
    redisConfig.port = redisConfig.port || 6379
    redisConfig.dbNumber = redisConfig.dbNumber || 0
    redisConfig.key = redisConfig.key || "kafka-consumer-info"; 
    
    await redis.init(redisConfig)

    /* init kafka */
    if (!kafkaConfig.clientId) {
        throw "kafkaConfig.clientId is not defined"
    }

    clientId = kafkaConfig.clientId

    let brokers = kafkaConfig.brokers

    if (Array.isArray(brokers) && brokers.length > 0) {
        brokers = brokers.map(({ host, port }) => {
            return `${host}:${port}`
        })
    } else {
        brokers = ["localhost:9092"]
    }

    kafka = new Kafka({
        clientId: clientId,
        brokers: brokers,
        ssl: kafkaConfig.ssl,
        sasl: kafkaConfig.sasl,
        logCreator: (level) => (entry) => {
            CALLBACK_EVENT.kafkaLog(level, entry)

            if (level === logLevel.ERROR) {
                CALLBACK_EVENT.error(`kafkajs error see the detail:\n${JSON.stringify(entry, null, 2)}`)
            }
        },
    })

    globalRedisConfig = redisConfig
    globalProducerConfig = producerConfig
}

/**
 * 
 * @param {ConsumerGroup} consumerGroup 
 */
const setConsumer = async (consumerGroup) => {
    if (clientId === null) {
        throw "init function call must precede."
    }

    try {
        for (const groupId in consumerGroup) {
            const fromBeginning = consumerGroup[groupId].fromBeginning       // 처음부터 메시지를 소비할지 여부
            const topicNames = []                                            // 컨슈머가 구독할 토픽 배열
            const partitionAssigners = []                                    // 파티셔너를 담을 배열
            let isPartitionAssign = consumerGroup[groupId].isAssignPartition // 소비할 파티션을 지정할지 여부
            let topics = consumerGroup[groupId].topics                       // 구독할 토픽 정보를 포함한 토픽 정보 객체

            // isPartitionAssign 정의되지 않은경우 "사용 안함" 으로 설정
            if (isPartitionAssign === undefined || isPartitionAssign === null || typeof isPartitionAssign !== "boolean") {
                isPartitionAssign = false
            }
        
            // 파티션을 정의해서 직접 소비하는경우
            if (isPartitionAssign) {
                partitionAssigners.push(await getPartitionAssigner(topics))
            }

            partitionAssigners.push(roundRobin)

            const consumer = kafka.consumer({
                groupId: groupId,
                partitionAssigners: partitionAssigners,
            })

            topics.forEach(({ name }) => {
                topicNames.push(name)
            })

            consumers.push({
                topics: topicNames,
                groupId: groupId,
                fromBeginning: fromBeginning,
                kafkaConsumer: consumer
            })
        }

        // 모든 컨슈머가 컨슈머 그룹 참여시 CONSUMERS_LOAD_COMPLETE 실행을 위한 변수
        let consumerGroupJoinCount = 0

        for (const item of consumers) {
            const consumer = item.kafkaConsumer         // 카프카에서 생성된 consumer 객체
            const topics = item.topics                  // 해당 컨슈머가 구독할 토픽이름 배열
            const fromBeginning = item.fromBeginning    // 파티션 처음부터 소비할지 여부

            // 컨슈머 그룹 조인 이벤트 
            consumer.on(consumer.events.GROUP_JOIN, async (event) => {
                const payload = event.payload
                const memberAssignment = payload.memberAssignment
                const consumerInfo = {}

                for (const topic in memberAssignment) {
                    consumerInfo[topic] = {
                        groupId: payload.groupId,
                        memberId: payload.memberId,
                        leaderId: payload.leaderId,
                        isLeader: payload.isLeader,
                        groupProtocol: payload.groupProtocol,
                    }

                    if (payload.groupProtocol === CUSTOM_GROUP_PROTOCOL) {
                        consumerInfo[topic].partitions = memberAssignment[topic]
                    }
                }
    
                try {
                    // 그룹에 참가한 컨슈머 정보 redis 저장
                    await redis.hSet(clientId, consumerInfo)

                    // 그룹 참여 콜백 이벤트 실행
                    await CALLBACK_EVENT.joinGroup(payload)

                    consumerGroupJoinCount += 1

                    // 모든 컨슈머가 컨슈머 그룹 참여시
                    if (consumerGroupJoinCount === consumers.length) {
                        await CALLBACK_EVENT.consumerLoadComplete(consumers)
                    }
                } catch (err) {
                    CALLBACK_EVENT.error(err.toString())
                }
            })
    
            // 컨슈머 연결
            await consumer.connect()
    
            // 컨슈머 토픽 구독
            await consumer.subscribe({ topics: topics, fromBeginning: fromBeginning })
    
            // 컨슈머 메시지 소비
            await consumer.run({
                eachMessage: async ({ topic, partition, message }) => {
                    try {
                        const headers = message.headers
                        const key = message.key
                        const value = message.value

                        /**
                         * @type {MessageConsumeInfo}
                         */
                        const messageConsumeInfo = {
                            headers: {},
                            key: null,
                            value: null,
                        }

                        // headers 파싱
                        for (const key in headers) {
                            messageConsumeInfo.headers[key] = headers[key].toString()
                        }

                        if (typeof headers.data === "string") {
                            try {
                                const data = JSON.parse(headers.data)

                                for (const key in data) {
                                    if (!(key === "departure" || key === "arrival")) {
                                        messageConsumeInfo.headers[key] = data[key]
                                    }
                                }

                                delete messageConsumeInfo.headers.data
                            } catch (err) { }
                        }

                        // key 파싱
                        if (key) {
                            messageConsumeInfo.key = key.toString()
                        }

                        // value 파싱
                        try {
                            messageConsumeInfo.value = JSON.parse(value.toString())
                        } catch (err) {
                            messageConsumeInfo.value = value.toString()
                        }

                        await CALLBACK_EVENT.eachMessage(topic, partition, messageConsumeInfo)
                    } catch (err) {
                        CALLBACK_EVENT.error(err.toString())
                    }
                }
            })
        }
    } catch (err) {
        CALLBACK_EVENT.error(err.toString())
    }
}

/**
 * 독립 실행 컨슈머 파티셔너 생성
 * @param {Topic[]} topics 토픽 정보 배열 
 * @returns
 */
const getPartitionAssigner = async (topics) => {
    /**
     * { name: 컨슈머가 소비할 토픽이름, partitions: 컨슈머가 소비할 토픽의 파티션 (number 배열) }
     * name: topicA, partitions: [2]    >  topicA 토픽의 2번 파티션 소비
     * name: topicB, partitions: [0, 2] >  topicB 토픽의 0, 2번 파티션 소비
     */
    topics = await Promise.all(topics.map(async ({ name, partitions }) => {
        // 파티션을 지정하지 않은 경우 모든 파티션 컨슘
        if (!Array.isArray(partitions)) {
            const metadata = await admin.fetchTopicMetadata({ topics: [name] })
            const partitionSize = metadata.topics[0].partitions.length
            partitions = Array.from({ length: partitionSize }, (_, i) => i)
        }
        // 파티션을 지정한 경우 해당 파티션을 컨슘

        return { name, partitions };
    }))

    /**
     * @type {Assignment}
     */
    const assignment = {}

    topics.forEach(({ name, partitions }) => {
        assignment[name] = partitions
    })

    /**
     * @type {Assigner} Custom Assigner 생성
     */
    const assigner = {
        name: CUSTOM_GROUP_PROTOCOL,
        version: 1,
        async assign({ members, topics }) {
            return members.map((member) => ({
                memberId: member.memberId,
                memberAssignment: AssignerProtocol.MemberAssignment.encode({
                    version: this.version,
                    assignment: assignment,
                    userData: Buffer.alloc(0),
                })
            }))
        },
        protocol({ topics }) {
            return {
                name: this.name,
                metadata: AssignerProtocol.MemberMetadata.encode({
                    version: this.version,
                    topics,
                    userData: Buffer.alloc(0),
                })
            }
        }
    }

    return ({ cluster }) => assigner
}

/**
 * Kafka message producer
 * @param {MessageSendInfo}    messageSendInfo 메시지 전송 객체
 * @param {MessageSendOptions} options         메시지 전송 옵션
 * @returns 
 */
const send = async (messageSendInfo, options) => {
    if (!messageSendInfo) {
        throw "messageSendInfo is require"
    }

    const topic = messageSendInfo.topic
    const arrival = messageSendInfo.arrival
    const key = messageSendInfo.key
    let value = messageSendInfo.value
    const headers = messageSendInfo.headers
    let partitions = messageSendInfo.partitions

    if (!topic || typeof topic !== "string" || topic === "") {
        throw "topic is require"
    }

    if (producer === null) {
        producer = kafka.producer(globalProducerConfig)
        await producer.connect()
    }

    try {
        if (typeof value === "object") {
            value = JSON.stringify(value)
        }

        if (!Array.isArray(partitions) || partitions.length === 0) {
            if (arrival && typeof arrival === "string") {
                const consumerInfo = await redis.hGet(arrival)
    
                // 해당 클라이언트가 구독중인 토픽의 컨슈머가 Custom Assigner 로 정의되어 있는경우
                if (consumerInfo && consumerInfo[topic] && consumerInfo[topic].groupProtocol === CUSTOM_GROUP_PROTOCOL) {
                    partitions = consumerInfo[topic].partitions
                }
            }
        }

        // 전송(producer) 할 메시지 배열
        const messages = []

        // partitions 배열에 파티션이 명시되어 있는경우, 정의된 파티션 개수만큼 메시지를 생성
        if (Array.isArray(partitions) && partitions.length > 0) {
            for (const partition of partitions) {
                /**
                 * @type {Message}
                 */
                const message = {
                    key: key,
                    value: value,
                    partition: partition,
                    headers: {
                        departure: clientId,
                        data: null,
                    }
                }

                if (arrival !== undefined && arrival !== null) {
                    message.headers.arrival = arrival
                }

                if (typeof headers === "object") {
                    message.headers.data = JSON.stringify(headers)
                }

                messages.push(message)
            }
        } else {
            /**
             * @type {Message}
             */
            const message = {
                key: key,
                value: value,
                headers: {
                    departure: clientId,
                    data: null,
                }
            }

            if (arrival !== undefined && arrival !== null) {
                message.headers.arrival = arrival
            }

            if (typeof headers === "object") {
                message.headers.data = JSON.stringify(headers)
            }

            messages.push(message)
        }

        /**
         * @type {ProducerRecord}
         */
        const producerRecord = {
            topic: topic,
            messages: messages
        }

        if (options !== undefined && options !== null) {
            producerRecord.acks = options.acks
            producerRecord.compression = options.compression
            producerRecord.timeout = options.timeout
        }

        await producer.send(producerRecord)
    } catch (err) {
        CALLBACK_EVENT.error(err.toString())
    }
}

/**
 * redis & kafka 연결 종료
 */
const exit = () => {
    try {
        // [disconnect] kafka producer
        if (producer !== null) {
            producer.disconnect()
        }
        
        for (const consumer of consumers) {
            const kafkaConsumer = consumer.kafkaConsumer

            // [disconnect] kafka consumer 
            kafkaConsumer.disconnect()
        }

        // [disconnect] redis
        redis.quit()
    } catch (err) {
        CALLBACK_EVENT.error(err.toString())
    }

    const groupIds = []

    for (const consumer of consumers) {
        groupIds.push(consumer.groupId)
    }

    /**
     * @type {import('./module/afterExit.js').ExitInfo}
     */
    const exitInfo = {
        redisConfig: globalRedisConfig,
        consumerInfo: {
            clientId: clientId,
            groupIds: groupIds,
        }
    }

    const command = `node ${path.join(__dirname, './module/afterExit.js')} '${JSON.stringify(exitInfo)}'`

    require('child_process').exec(command)
}

module.exports = {
    on,
    init,
    setConsumer,
    send,
    CALLBACK_TYPE,
    exit,
}