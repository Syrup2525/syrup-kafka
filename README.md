# syrup-kafka
node.js 에서 kafka 사용시 컨슈머와 프로듀서를 쉽게 생성하고 관리해주는 유틸 모듈 입니다.

## Motivation
`syrup-kafka`는 [kafkajs](https://github.com/tulios/kafkajs) 오픈소스 라이브러리를 기반으로 제작된 kafka 라이브러리 입니다. 기존 [kafkajs](https://github.com/winstonjs/winston) 라이브러리의 컨슈머, 프로듀서 기능과 더불어 `독립 실행 컨슈머` 생성을 간단하게 구성 가능하며 [redis](https://github.com/redis/redis) 를 활용한 현재 컨슈머 상태 저장 기능을 지원합니다. 이 문서에서는 `토픽`, `프로듀서`, `컨슈머`, `컨슈머 그룹`, `파티션` 등과 같은 kafka 의 기본적인 개념은 이해하고 있다고 가정하고 이러한 내용들을 따로 다루고 있지는 않습니다. Kafka의 기본 개념과 용어에 관해서는 Kafka가 제공하는 문서인  [Introduction](https://kafka.apache.org/intro) 과 [Main Concpets and Terminology](https://kafka.apache.org/documentation/#intro_concepts_and_terms) 를 참고해 주세요.

## Installation
``` bash
npm install syrup-kafka
```

## Quick Start
빠른 시작 예제를 `./examples/` 폴더에서 확인할수 있습니다. [`./examples/*.js`][examples] 에는 `producer` 및 `consumer` 생성 예제가 있습니다.

> 소스코드를 수정없이 바로 사용하는 경우에 `const kafka = require('../lib/index.js')` 부분을 `const kafka = require('syrup-kafka')` 로 수정해야 합니다.

## Usage
`syrup-kafka`를 사용하는 예시 코드는 다음과 같습니다.

``` js
const kafka = require('syrup-kafka')

const startMain = async () => {
    const redisConfig = {
        host: "localhost",
        port: 6379,
        dbNumber: 0,
        key: "kafka-consumer-exmaple-key",
    }

    const kafkaConfig = {
        clientId: `example-client`,
        brokers: [
            {
                host: "localhost",
                port: 9092,
            },
        ],
    }

    const producerconfig = {
        allowAutoTopicCreation: false,
        transactionTimeout: 30000,
    }

    await kafka.init(redisConfig, kafkaConfig, producerconfig)

    // - 메시지 전송 및 소비 실행

    // 프로세스 종료 전 kafka.exit() 함수를 호출 합니다.
    kafka.exit(() => {
        // kafka.exit 처리 이후 수행되여야 할 코드
    })
}

startMain()
```
`syrup-kafka` 에서 사용되는 `producer` 역할을 하는 함수인 [`send`](#send-message), `consumer` 를 생성하는 [`setConsumer`](#create-consumer) 함수를 호출하기 전, 반드시 `init` 함수를 호출하여야 합니다. [`init`](#usage) 함수를 선행하지 않고 [`send`](#send-message), [`setConsumer`](#create-consumer) 함수를 호출하면 `throw - exception` 이벤트가 발생합니다.

## Table of contents
* [Motivation](#motivation)
* [Installation](#installation)
* [Usage](#usage)
* [Table of Contents](#table-of-contents)
* [Config](#config)
  * [Redis Config](#redis-config)
  * [Kafka Config](#kafka-config)
  * [Producer Config](#producer-config)
* [Create Consumer](#create-consumer)
  * [RoundRobin Consumer](#roundrobin-consumer)
  * [Custom Consumer](#custom-consumer)
* [Create Producer](#create-producer)
  * [Send Message](#send-message)
* [Callback Event](#callback-event)
  * [ERROR](#error)
  * [KAFKA_LOG](#kafka_log)
  * [EACH_MESSAGE](#each_message)
  * [JOIN_GROUP](#join_group)
  * [CONSUMERS_LOAD_COMPLETE](#consumers_load_complete)
* [Disconnection & Exit](#disconnection--exit)

## Config
아래는 [kafkajs](https://github.com/tulios/kafkajs) 및 [redis](https://github.com/redis/redis) 사용을 위한 Config 객체 정의 방법을 설명합니다.

### Redis Config
``` js
const redisConfig = {
    host: "localhost",
    port: 6379,
    dbNumber: 0,
    key: "kafka-consumer-exmaple-key",
    username: "username",
    password: "password",
}
```

각 옵션에 대한 설명은 다음과 같습니다.

* `host` redis 연결시 필요한 host 주소 입니다. 미입력시 기본값 `localhost`
* `port` redis 연결시 필요한 port 번호 입니다. 미입력시 기본값 `6379`
* `dbNumber` consumer 정보가 저장되는 DB 번호 입니다. 미입력시 기본값 `0`
* `key` consumer 정보가 저장되는 key 이름 입니다. 미입력시 기본값 `kafka-consumer-info`
* `username` redis [ACL](https://redis.io/topics/acl) 유저 이름
* `password` redis [ACL](https://redis.io/topics/acl) 암호 혹은 이전 `--requirepass` 암호 

> [Create Consumer](#create-consumer) 로 `consumer` 를 생성하면, `consumer` 에 대한 정보가 [Redis Config](#redis-config) 에 정의된 `key` 에 hash 자료구조로 저장됩니다.
> 
> `HGETALL key` 등의 명령어로 현재 생성된 `consumer` 정보를 확인 가능하며, hash 자료구조 안에서의 key 는 [Kafka Config](#kafka-config) 에서 정의한 `clientId` 로 설정됩니다.
>
> 아래는 `kafka-consumer-info` key 를 가진 hash 자료구조 내에서 `consumer-server-1` key 의 예시 내용입니다.
>
> ``` json
> {
>   "topicA": {
>     "partitions": [
>       1
>     ],
>     "groupId": "topicA-server:1-group",
>     "memberId": "consumer-server-1-a796c4eb-3655-4e2e-b00e-3f40a94680ab",
>     "leaderId": "consumer-server-1-a796c4eb-3655-4e2e-b00e-3f40a94680ab",
>     "isLeader": true,
>     "groupProtocol": "custom-assigner"
>   },
>   "topicB": {
>     "groupId": "topicB-consumer-group",
>     "memberId": "consumer-server-1-cb3ce39f-e325-427c-b02c-8d0837595ec8",
>     "leaderId": "consumer-server-0-52b26999-34d6-409a-8e00-ef5f075e7716",
>     "isLeader": false,
>     "groupProtocol": "RoundRobinAssigner"
>   }
> }
> ```
>
> 위 예시에서 다음과 같은 정보를 확인할 수 있습니다.
>
> * 객체에서 key(field) 는 토픽의 이름입니다. [Kafka Config](#kafka-config) 에서 `clientId` 를 `consumer-server-1` 로 정의한 서버는 `topicA`, `topicB` 에 대한 토픽을 수신합니다.
> * `topicA` 토픽을 소비하는 `consumer` 는 `groupProtocol` 값이 `custom-assigner` 이므로 [Custom Consumer](#custom-consumer) 로 생성되었습니다.
> * `topicA` 토픽에서 1번 파티션을 지정하여 메시지를 소비합니다.
>> 위의 예시에서 `topicA` key 에 대한 value 는 `topicA` 토픽을 소비하는 consumer 정보를 나타낼 뿐이며, key 의 개수가 2개 (`topicA`, `topicB`) 라고 해서 consumer 가 2개 생성되는 것은 아닙니다. 실제 생성되는 consumer 의 개수는 [Create Consumer](#create-consumer) 에서 생성한 `컨슈머 그룹 ID` 를 정의한 개수만큼 생성됩니다.

### Kafka Config
``` js
const kafkaConfig = {
    clientId: `example-client`,
    brokers: [
        {
            host: "localhost",
            port: 9092,
        },
        {
            host: "localhost",
            port: 9093,
        },
    ],
    ssl: {
        rejectUnauthorized: false,
        ca: [fs.readFileSync('/my/custom/ca.crt', 'utf-8')],
        key: fs.readFileSync('/my/custom/client-key.pem', 'utf-8'),
        cert: fs.readFileSync('/my/custom/client-cert.pem', 'utf-8')
    },
    sasl: {
        mechanism: 'plain', // scram-sha-256 or scram-sha-512
        username: 'my-username',
        password: 'my-password'
    }
}
```
각 옵션에 대한 설명은 다음과 같습니다.
* `clientId` 프로세스를 구별하기 위한 식별 id 입니다. 해당값은 필수이며 미입력시 `exception` 이 발생합니다.
* `brokers` kafka 연결시 필요한 broker 목록 입니다. 배열이 없가나 배열 아이템 개수가 0인경우 기본적으로 `localhost:9092` 로 연결을 시도합니다.
* `brokers.host` broker host 주소 입니다. 유효하지 않은 값을 입력시 `exception` 오류가 발생할 수 있습니다.
* `brokers.port` broker port 번호 입니다. 유효하지 않은 값을 입력시 `exception` 오류가 발생할 수 있습니다.
* `ssl` TLS 통신을 위한 ssl 설정 속성 입니다. 사용하지 않을시 값을 생략 가능합니다.
* `sasl` kafka SASL 클라이언트 인증을 위한 속성 입니다. 사용하지 않을시 값을 생략 가능합니다.

> [ssl](https://kafka.js.org/docs/configuration#ssl) 및 [sasl](https://kafka.js.org/docs/configuration#sasl) 적용에 대한 내용은 각 링크를 확인해 주세요

### Producer Config
``` js
const producerconfig = {
    allowAutoTopicCreation: false,
    transactionTimeout: 30000,
}
```
메시지를 발행할때 사용되는 `producer` 의 옵션입니다. `init` 함수 호출시 세번째 인자로 사용되며 생략할 수 있습니다. 각 옵션에 대한 설명은 다음과 같습니다.

| 옵션                    | 설명 | 기본값 |
| ---------------------- | --- | ---- |
| createPartitioner      | [커스텀 파티셔너](https://kafka.js.org/docs/producing#custom-partitioner) 생성시 사용됩니다. | `null`
| retry                  | [재시도](https://kafka.js.org/docs/configuration#default-retry) 정책 설정시 사용됩니다. | `null`
| metadataMaxAge         | `metadata` 에 대한 변경이 오랜시간 감지되지 않아도 `metadata` 를 강제로 새로 고치는 밀리초 시간 | `300000` (5분)
| allowAutoTopicCreation | 존재하지 않는 `topic` 에 대해 `message` 를 발행하는 경우 자동으로 `topic` 을 생성할지에 대한 여부 | `true`
| transactionTimeout     | 트랜잭션 상태 업데이트를 기다리는 최대 시간, `broker` `transaction.max.timeout.ms` 의 설정 보다 크면 오류 InvalidTransactionTimeout 와 함께 요청이 실패합니다. | `60000`

> `idempotent` 및 `maxInFlightRequests` 와 같은 설명되지 않은 추가 속성에 대한 자세한 사항은 [해당 문서](https://kafka.js.org/docs/producing#options) 를 참고해주세요.

## Create Consumer
`syrup-kafka` 에서 `consumer` 를 생성하는 방법은 `setConsumer` 함수를 이용하는 것입니다. 아래는 기본 컨슈머인 [RoundRobin Consumer](#roundrobin-consumer) 와 특정 파티션을 지정해서 메시지를 소비하는 [Custom Consumer](#custom-consumer) 를 정의하는 방법을 설명합니다.

> 컨슘된 메시지 수신은 [EACH_MESSAGE](#each_message) 이벤트를 참고해주세요.

### RoundRobin Consumer
``` js
const kafka = require('syrup-kafka')

// - kafka.init 함수 호출이 필요합니다.
// - ...

const consumerGroup = {
    "topic-consumer-group-id": {
        isPartitionAssign: false,
        fromBeginning: true,
        topics: [
            {
                name: `example-topic`,
            },
        ],
    }
}

await kafka.setConsumer(consumerGroup)

// - ...
```
RoundRobin 컨슈머를 생성하는 일부 소스코드 입니다. `isPartitionAssign` 속성을 `false` 로 선언시에 기본적으로 해당 컨슈머는 RoundRobin 컨슈머로 생성되며 `컨슈머 그룹 아이디` 는 위 코드 `topic-consumer-group-id` 에서 확인할 수 있듯이 속성 key 로 지정하면 됩니다. 이때 key 에 대한 value 는 컨슈머 그룹에 참여할 컨슈머의 정보를 포함합니다.
* `isPartitionAssign` 파티션을 직접 지정하여 메시지를 소비할지 여부
* `fromBeginning` 컨슈머 그룹에서 오프셋 커밋이 없는 경우 메시지를 파티션 처음부터 소비할지 여부 
* `topics` 컨슈머가 소비할 토픽정보 배열
* `topics.name` 메시지를 소비할 토픽의 이름

### Custom Consumer
기본 [RoundRobin Consumer](#roundrobin-consumer) 를 사용하는 것이 아닌, 사용자가 직접 토픽의 특정 파티션을 지정하여 소비하는 경우가 필요한 경우 [Custom Consumer](#custom-consumer) 를 사용할 수 있습니다.

``` js
const kafka = require('syrup-kafka')

// - kafka.init 함수 호출이 필요합니다.
// - ...
const consumerGroup = {
    `topic-consumer-group-id`: {
        isAssignPartition: true,
        fromBeginning: true,
        topics: [
            {
                name: `topicA`,
                partitions: [0],
            },
        ]
    }
}

// - ...
```
커스텀 컨슈머(`독립 실행 컨슈머`)를 생성하는 일부 소스코드 입니다. `isPartitionAssign` 속성을 `true` 로 선언시 `독립 실행 컨슈머` 타입으로 생성되며 `컨슈머 그룹 ID` 는  [RoundRobin Consumer](#roundrobin-consumer) 에서 정의한 것과 동일한 방식으로 속성 key 로 지정하면 됩니다. 위 에제 코드에서 `컨슈머 그룹 ID`는 `topic-consumer-group-id` 가 되며, 이때 value 는 컨슈머 그룹에 참여할 컨슈머의 정보를 포함합니다.
* `isPartitionAssign` 파티션을 직접 지정하여 메시지를 소비할지 여부
* `fromBeginning` 컨슈머 그룹에서 오프셋 커밋이 없는 경우 메시지를 파티션 처음부터 소비할지 여부 
* `topics` 컨슈머가 소비할 토픽정보 배열
* `topics.name` 메시지를 소비할 토픽의 이름
* `topics.partitions` 메시지를 소비할 파티션 번호 배열

> [Custom Consumer](#custom-consumer) 로 컨슈머를 생성한 경우 각기 다른 서버에서 생성된 컨슈머들이 동일한 `컨슈머 그룹` 에 속해 있더라도 `topics.partitions` 에 정의한 파티션의 메시지를 각자 모두 소비합니다.

## Create Producer
`producer` 객체의 생성 시점은 `send` 함수 실행시 `syrup-kafka` 라이브러리 내부에 `producer` 객체가 존재지 않는 경우 싱글턴 패턴으로 생성되며 kafka broker 에 연결 됩니다. 메시지의 전송은 [Send Message](#send-message) 에서 확인 가능합니다.

### Send Message
``` js
const kafka = require('syrup-kafka')

// - kafka.init 함수 호출이 필요합니다.
// - ...

// 일반적인 메시지 전송
await kafka.send({
    topic: "topicA",
    value: "test message",
})

// key 가 포함된 형태의 메시지 전송
await kafka.send({
    topic: "topicA",
    key: "key1",
    value: "test message",
})

// 토픽의 특정 파티션에 메시지 전송
await kafka.send({
    topic: "topicB",
    partitions: [0, 1],
    value: "test message",
})

// client id 를 직접 지정하여 독립 실행 컨슈머에게 메시지 전송
await kafka.send({
    topic: "topicC",
    arrival: `standalone-consumer`,
    value: "test message",
})

// partitions 와 arrival 동시에 선언시 arrival 는 무시됨
// topicD 토픽의 0번 파티션에 메시지 생성
await kafka.send({
    topic: "topicD",
    partitions: [0],
    arrival: `standalone-consumer`, // 속성이 무시됨
    value: "test message",
})

// 옵션을 사용하여 메시지 전송
const options = {
    acks: -1,
    timeout: 30000,
    compression: CompressionTypes.None,
}

await kafka.send({
    topic: "topicE",
    value: "test message",
    options: options,
})

// - ...
```
`send` 함수를 사용하여 메시지를 토픽에 전송할수 있습니다. `send` 함수에서 사용되는 객체의 속성은 `topic` `partitions` `arrival` `key` `value` `options` 입니다. 각 속성의 의미는 다음과 같습니다.

* `topic` 메시지 전송할 토픽 이름입니다. 값이 반드시 있어하며 문자열 형태여야 합니다. 값이 없거나 공백인 경우, 문자열이 아닌경우 `throw - exception` 이 발생합니다.
* `partitions` 파티션을 지정하여 메시지를 전송하고자 할때 사용합니다. number 배열 형태로 데이터를 입력해야하며, 해당 값이 존재하지 않는 경우 기본 파티셔너를 통해 메시지가 전송됩니다.
* `arrival` 전송한 데이터를 소비하고자 하는 컨슈머가 [Custom Consumer](#custom-consumer) 로 정의되어 있는경우 [Kafka Config](#kafka-config) 에서 등록한 `clientId` 를 `arrival` 에 등록시 파티션 번호를 명시하지 않아도 해당 [Custom Consumer](#custom-consumer) 가 소비하는 파티션으로 메시지를 전송합니다.
* `key` 전송하려는 key 값 입니다.
* `value` 전송하려는 메시지 내용 입니다. 별도의 타입이 없으며 원하는 형태로 전송할 수 있습니다.
* `options` 전송하려는 메시지의 옵션 입니다. 옵션을 사용하지 않을시 생략 가능합니다. `options` 에 대한 각 속성은 [여기](#message-send-options) 를 참고해 주세요.

> `partitions` 와 `arrival` 속성을 동시에 선언한 경우에는 `partitions` 속성이 우선권을 가지며 `arrival` 은 무시됩니다.

> #### `key` 의 추가적인 설명
>
> `key` 는 메시지를 보낼 파티션을 결정하는데 사용됩니다. 이는 동일한 관련된 메시지가 순서대로 처리되도록 하는데 필요하며 예를 들어, `orderId` 를 `key` 로 사용시 주문과 관련된 모든 메시지가 순서대로 처리되도록 할 수 있습니다.
>
> 기본적으로 `producer` 는 다음 로직에 따라 메시지를 배포하도록 구성됩니다.
> * 메시지에 파티션이 지정되어 있는 경우 해당 파티션을 선택
> * 파티션이 지정되지 않았지만 키가 있는 경우 키의 해시 (murmur2) 기반으로 파티션을 선택
> * 파티션이나 키가 없으면 라운드 로빈 방식으로 파티션을 선택

> #### Message send `options`
> | 속성 | 설명 | 기본값 |
> | --- | --- | ---- |
> | acks | 필요한 ack 수를 제어 <br><br> `-1` (all) leader 파티션과 모든 follow 파티션이 메시지를 수신하였는지 확인합니다. <br> `0` broker 에게 메시지 전달이 정상적으로 되었는지만 확인합니다. <br> `1` leader 파티션에게 메시지가 제대로 전달되었는지를 확인합니다. follow 파티션은 확인하지 않습니다. | `-1` |
> | timeout | 응답 대기시간 | `30000` |
> | compression | 압축 코덱 | `CompressionTypes.None` |
> 

## Callback Event
Callback 함수를 등록하여 특정 이벤트에 대한 수신이 가능합니다. `init` 함수 이전/이후 순서가 중요하진 않지만 `init` 함수 호출 이전에 Callback 함수를 등록하는것을 권장합니다.

아래는 Callback 함수의 종류와 등록 방법을 설명합니다.

``` js
const kafka = require('syrup-kafka')

// - ...

kafka.on(kafka.CALLBACK_TYPE.ERROR, async (message) => {

})

kafka.on(kafka.CALLBACK_TYPE.KAFKA_LOG, async (level, entry) => {

})

kafka.on(kafka.CALLBACK_TYPE.EACH_MESSAGE, async (topic, partition, message) => {

})

kafka.on(kafka.CALLBACK_TYPE.JOIN_GROUP, async (payLoad) => {

})

kafka.on(kafka.CALLBACK_TYPE.CONSUMERS_LOAD_COMPLETE, async (consumers) => {

})

// - ...

// kafka.init 함수 호출

// - ...
```
* [ERROR](#error) 라이브러리 동작 오류 발생시
* [KAFKA_LOG](#kafka_log) `kafkajs` 라이브러리의 로그를 로깅하고자 할 때
* [EACH_MESSAGE](#each_message) 등록된 컨슈머에 의해 메시지가 소비될 때
* [JOIN_GROUP](#join_group) 컨슈머가 컨슈머 그룹에 참가를 완료했을 때
* [CONSUMERS_LOAD_COMPLETE](#consumers_load_complete) 정의된 모든 컨슈머들이 각 컨슈머 그룹에 참가를 완료했을 때

### ERROR
``` js
const kafka = require('syrup-kafka')

// - ...

kafka.on(kafka.CALLBACK_TYPE.ERROR, async (message) => {
    console.error(message)
})

// - ...
```
`syrup-kafka` 라이브러리 동작 오류 발생시 이 이벤트가 호출 되며 message 는 `string` 타입 입니다. [KAFKA_LOG](#kafka_log) 이벤트의 `error` 수준의 로그 메시지도 이 콜백에서 함께 수신됩니다.

### KAFKA_LOG
``` js
const kafka = require('syrup-kafka')

// - ...

kafka.on(kafka.CALLBACK_TYPE.KAFKA_LOG, async (level, entry) => {
    console.log(`level: ${level}, entry:\n${JSON.stringify(entry, null, 2)}`)
})

// - ...
```
`syrup-kafka` 내부에서 사용되는 kafka 라이브러리인 `kafkajs` 라이브러리에 대한 로깅이 필요한 경우 이 이벤트로 수신 가능합니다.

`level` 은 다음 값을 가집니다.

| level | label     | 추가 설명                                    |
| ----- | --------- | ------------------------------------------ |
| 0     | `NOTHING` |                                            |
| 1     | `ERROR`   | 이 경우, [ERROR](#error) 이벤트가 함께 발생합니다. |
| 2     | `WARN`    |                                            |
| 4     | `INFO`    |                                            |
| 5     | `DEBUG`   |                                            |

`entry` 는 다음과 같은 속성을 가지며 예를들어 이러한 값들이 올수 있습니다.
* `level` 4,
* `label` 'INFO', // NOTHING, ERROR, WARN, INFO, or DEBUG
* `timestamp` '2017-12-29T13:39:54.575Z'
* `logger` 'kafkajs'
* `message` 'Started'

> 더 자세한 `kafkajs` logger 에 대한 내용은 [해당 문서](https://kafka.js.org/docs/custom-logger) 를 참고해주세요.

### EACH_MESSAGE
``` js
const kafka = require('syrup-kafka')

// - ...

kafka.on(kafka.CALLBACK_TYPE.EACH_MESSAGE, async (topic, partition, message) => {
    console.log(`${JSON.stringify({
        topic: topic,
        partition: partition,
        headers: message.headers,
        key: message.key,
        value: message.value,
    }, null, 2)}`)
})

// - ...
```
컨슈머 그룹에 참가한 컨슈머들이 메시지를 수신했을때 이벤트가 호출 됩니다.

* `topic` 메시지가 수신된 토픽 이름 `string`
* `partition` 메시지가 수신된 파티션 번호 `number`
* `message` 수신된 메시지 정보 `object`

> `message` 객체의 속성을 정의하고 있습니다.
> * `key` 파티셔닝에 사용되는 key 값. 자세한 내용은 [key 의 추가적인 설명](#key-의-추가적인-설명) 을 참고해 주세요.
> * `value` 메시지 내용
> * `headers` 메시지의 헤더 정보 `object`
>> `headers` 에는 다음 정보가 포함되어 있습니다.
>> * `departure` 메시지가 생성된 프로듀서의 clientId
>> * `arrival` 메시지가 도착할 컨슈머가 정의된 clientId (지정된 경우)

### JOIN_GROUP
``` js
const kafka = require('syrup-kafka')

// - ...

kafka.on(kafka.CALLBACK_TYPE.JOIN_GROUP, async (payLoad) => {
    console.log(JSON.stringify(payLoad, null, 2))
})

// - ...
```
컨슈머가 컨슈머 그룹에 참가를 성공한 경우 이벤트가 호출 됩니다. 매개변수 `payLoad` 는 `kafkajs` 내부에 정의되어 있는 `ConsumerGroupJoinEvent` 타입 입니다.

> 예를 들어 컨슈머를 3개 정의한 경우 각 컨슈머들이 정의된 컨슈머 그룹에 정상적으로 참여에 성공한 경우 해당 이벤트는 3번 호출 됩니다.

> `ConsumerGroupJoinEvent` 타입은 다음 속성이 있습니다.
> * `duration` number
> * `groupId` string
> * `isLeader` boolean
> * `leaderId` string
> * `groupProtocol` string
> * `memberId` string
> * `memberAssignment` [key: string]: number[]

### CONSUMERS_LOAD_COMPLETE
``` js
const kafka = require('syrup-kafka')

// - ...

kafka.on(kafka.CALLBACK_TYPE.CONSUMERS_LOAD_COMPLETE, async (consumers) => {
    // for (const consumer of consumers) {
    //     const topcis = consumer.topics
    //     const groupId = consumer.groupId
    //     const fromBeginning = consumer.fromBeginning
    //     const kafkaConsumer = consumer.kafkaConsumer
    //     ...
    // }
})

// - ...
```

[Create Consumer](#create-consumer) 에서 생성한 모든 컨슈머들이 정상적으로 컨슈머 그룹에 참가 완료 되었을때 이 이벤트가 호출 됩니다.

매갸변수로 전달되는 `consumers` 는 consumer[] 배열이며 `consumer` 객체에 대한 속성 정보는 다음과 같습니다

* `topics` 해당 컨슈머가 구독중인 토픽 목록
* `groupId` 해당 컨슈머가 속한 그룹 id
* `fromBeginning` 해당 컨슈머가 메시지를 처음부터 소비하는지에 대한 여부
* `kafkaConsumer` kafkajs consumer 객체

## Disconnection & Exit

``` js
const kafka = require('syrup-kafka')

// - ...

kafka.exit(() => {
    // kafka.exit 처리 이후 수행되여야 할 코드
})

// - ...
```

`redis`, `kafka` connection 종료 및 redis 에 저장된 컨슈머 정보 삭제를 위해 `exit()` 함수 호출이 필요합니다.

예를 들어 다음과 같이 `exit` 함수를 호출할 수 있습니다.

``` js
const kafka = require('syrup-kafka')

// - ...

await kafka.init(redisConfig, kafkaConfig)

// - ...

process.stdin.resume()

const exitHandler = (options, exitCode) => {
    kafka.exit(() => {
        if (options.cleanup) console.log('clean');
        if (exitCode || exitCode === 0) console.log(`exitCode: ${exitCode}`);
        if (options.exit) process.exit();
    })
}

process.on('exit', exitHandler.bind(null, { cleanup: true }));
process.on('SIGINT', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));
process.on('uncaughtException', exitHandler.bind(null, { exit: true }));
```

[examples]: https://github.com/Syrup2525/syrup-kafka/tree/main/examples