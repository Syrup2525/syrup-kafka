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
                clientId: `producer-server-${forkCount}`,
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
                console.log(`[worker_${forkCount}] [KAFKAJS] [consume] message: ${message}`)
            })
    
            kafka.on(kafka.CALLBACK_TYPE.ERROR, (message) => {
                console.log(`[worker_${forkCount}] [Error] message: ${message}`)
            })
    
            await kafka.init(redisConfig, kafkaConfig, {
                allowAutoTopicCreation: false,
            })

            await kafka.send({
                topic: "topicA",
                arrival: `consumer-server-${forkCount}`,
                value: "test message",
            })

            await kafka.send({
                topic: "topicB",
                value: "test message",
            })

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