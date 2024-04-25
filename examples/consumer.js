const kafka = require('../lib/index.js')

const serverStart = async () => {
    const cluster = require('cluster')
    const numCPUs = require('os').cpus().length

    if (cluster.isMaster) {
        for (let i = 0; i < numCPUs; i++) {
            const worker = cluster.fork()

            worker.send({ forkCount: i });
        }

        cluster.on('online', (worker) => {
            console.log(`${worker.process.pid}번 워커 실행`)
        })
    } else {
        process.on('message', async (msg) => {
            const forkCount = msg.forkCount

            const redisConfig = {
                host: "localhost",
                port: 6379,
                key: "kafka-consumer-info",
                dbNumber: 0,
            }
    
            const kafkaConfig = {
                clientId: `consumer-server-${forkCount}`,
                brokers: [
                    {
                        host: "localhost",
                        port: 9092,
                    }
                ],
            }
    
            kafka.on(kafka.CALLBACK_TYPE.JOIN_GROUP, async (payLoad) => {
                console.log(`[worker_${forkCount}] [KAFKAJS] group join success groupId: ${payLoad.groupId}, memberId: ${payLoad.memberId}`)
            })

            kafka.on(kafka.CALLBACK_TYPE.KAFKA_LOG, async (level, entry) => {
                console.log(`[worker_${forkCount}] [KAFKAJS] kafka log ${entry.label} message:\n ${JSON.stringify(entry, null, 2)}`)
            })

            kafka.on(kafka.CALLBACK_TYPE.CONSUMERS_LOAD_COMPLETE, async (consumers) => {
                console.log(`[worker_${forkCount}] [KAFKAJS] ${consumers.length} consumer load complete`)
            })
    
            kafka.on(kafka.CALLBACK_TYPE.EACH_MESSAGE, async (topic, partition, message) => {
                console.log(`[worker_${forkCount}] [KAFKAJS] [consume] \n${JSON.stringify({
                    topic: topic,
                    partition: partition,
                    headers: message.headers,
                    key: message.key,
                    value: message.value,
                }, null, 2)}`)
            })
    
            kafka.on(kafka.CALLBACK_TYPE.ERROR, (message) => {
                console.log(`[worker_${forkCount}] [Error] message: ${message}`)
            })
    
            await kafka.init(redisConfig, kafkaConfig)

            const groupId = `server:${forkCount}`

            const consumerGroup = {}

            consumerGroup[`topicA-${groupId}-group`] = {
                isAssignPartition: true,
                fromBeginning: true,
                topics: [
                    {
                        name: `topicA`,
                        partitions: [forkCount],
                    },
                ]
            }

            consumerGroup[`topicB-consumer-group`] = {
                isPartitionAssign: false,
                fromBeginning: true,
                topics: [
                    {
                        name: `topicB`,
                        partitions: null,
                    }
                ]
            }
    
            await kafka.setConsumer(consumerGroup)
    
            process.stdin.resume()
    
            const exitHandler = (options, exitCode) => {
                kafka.exit()

                if (options.cleanup) {
                    console.log('clean');
                }

                if (exitCode || exitCode === 0) {
                    console.log(`exitCode: ${exitCode}`);
                }

                if (options.exit) {
                    process.exit();
                }
            }

            process.on('exit', exitHandler.bind(null, { cleanup: true }));
            process.on('SIGINT', exitHandler.bind(null, { exit: true }));
            process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
            process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));
            process.on('uncaughtException', exitHandler.bind(null, { exit: true }));
        })
    }
}

serverStart()