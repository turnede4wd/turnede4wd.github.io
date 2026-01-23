/**
 * OneNET API 代理服務器
 * 用於解決CORS跨域限制問題
 * 
 * 使用方法：
 * 1. 安裝依賴：npm install express cors crypto-js
 * 2. 啟動服務器：node server.js
 * 3. 服務器將在 http://localhost:3000 運行
 */

const express = require('express');
const cors = require('cors');
const https = require('https');
const CryptoJS = require('crypto-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 中間件配置
app.use(cors()); // 啟用CORS
app.use(express.json()); // 解析JSON請求體

// 提供靜態文件（前端HTML文件）
app.use(express.static(path.join(__dirname)));

/**
 * 計算OneNET Token
 * @param {string} productId - 產品ID
 * @param {string} deviceName - 設備名稱
 * @param {string} deviceKey - 設備Key（Base64編碼）
 * @returns {string} - 計算出的Token字符串
 */
function calculateOneNETToken(productId, deviceName, deviceKey) {
    try {
        const version = '2018-10-31';
        // 簽名字符串中的資源名
        const res = `products/${productId}/devices/${deviceName}`;
        // Token中的資源名（URL編碼）
        const res1 = `products%2F${productId}%2Fdevices%2F${deviceName}`;

        const timestamp = Math.floor(Date.now() / 1000);
        const et = String(timestamp + 5 * 60); // 5分鐘有效期（與C++實現一致）
        const method = 'md5'; // 必須是MD5，不是SHA1

        // 簽名字符串格式：et + method + res + version
        const signString = `${et}\n${method}\n${res}\n${version}`;

        console.log('[Token計算] 詳細信息');
        console.log(`  資源名(簽名): ${res}`);
        console.log(`  簽名字符串: ${signString.replace(/\n/g, '\\n')}`);

        // 將deviceKey從Base64解碼為字節數組
        const decodedKey = CryptoJS.enc.Base64.parse(deviceKey);

        // 計算HMAC-MD5（關鍵：必須是MD5）
        const hmacResult = CryptoJS.HmacMD5(signString, decodedKey);

        // 轉換為Base64
        let signature = hmacResult.toString(CryptoJS.enc.Base64);

        console.log(`  HMAC-MD5結果 (Base64): ${signature}`);

        // URL編碼簽名 - 需要進行特殊字符替換（參考C++實現）
        signature = signature.replace(/\+/g, '%2B');
        signature = signature.replace(/ /g, '%20');
        signature = signature.replace(/\//g, '%2F');
        signature = signature.replace(/\?/g, '%3F');
        signature = signature.replace(/%/g, '%25');
        signature = signature.replace(/#/g, '%23');
        signature = signature.replace(/&/g, '%26');
        signature = signature.replace(/=/g, '%3D');

        console.log(`  簽名(URL編碼後): ${signature}`);

        // 拼接Token - 使用res1（URL編碼的資源名）
        const token = `version=${version}&res=${res1}&et=${et}&method=${method}&sign=${signature}`;

        console.log('[Token計算] 成功生成Token');
        console.log(`  產品ID: ${productId}`);
        console.log(`  設備名: ${deviceName}`);
        console.log(`  過期時間: ${et}秒後`);
        console.log(`  Token長度: ${token.length}`);

        return token;
    } catch (error) {
        console.error('[Token計算] 失敗:', error.message);
        throw new Error('Token計算失敗: ' + error.message);
    }
}

/**
 * OneNET API 連接端點
 * POST /api/onenet/connect
 */
app.post('/api/onenet/connect', async (req, res) => {
    try {
        const { token, topic, data } = req.body;

        if (!token || !topic || !data) {
            return res.status(400).json({
                success: false,
                statusCode: 400,
                message: '缺少必填參數: token, topic, data'
            });
        }

        console.log('[OneNET API] 收到連接請求');
        console.log(`  Token: ${token}`);
        console.log(`  Topic: ${topic}`);
        console.log(`  數據: ${JSON.stringify(data)}`);

        // OneNET API信息
        // 根據OneNET API文檔：
        // - Header Parameters: token, Content-Type
        // - Request Parameters: topic, protocol
        const baseUrl = 'https://www.onenet.hk.chinamobile.com:20080/fuse/http/device/thing/property/post';

        // 構建URL查詢參數：protocol 和 topic
        const queryParams = new URLSearchParams({
            protocol: 'MQTT',
            topic: topic
        });

        const oneNetUrl = `${baseUrl}?${queryParams.toString()}`;

        // 準備請求Header
        // 只需要两个header：token 和 Content-Type
        const requestOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token
            }
        };

        console.log('[OneNET API] 發送請求...');
        console.log(`  URL: ${oneNetUrl}`);
        console.log(`  Headers:`);
        console.log(`    Content-Type: ${requestOptions.headers['Content-Type']}`);
        console.log(`    token: ${token.substring(0, 30)}... (共${token.length}字符)`);
        console.log(`  Query Parameters:`);
        console.log(`    protocol: MQTT`);
        console.log(`    topic: ${topic}`);

        // 發送請求到OneNET
        const response = await new Promise((resolve, reject) => {
            const request = https.request(oneNetUrl, requestOptions, (response) => {
                let responseData = '';

                response.on('data', (chunk) => {
                    responseData += chunk;
                });

                response.on('end', () => {
                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body: responseData
                    });
                });
            });

            request.on('error', (error) => {
                reject(error);
            });

            // 發送請求體
            request.write(JSON.stringify(data));
            request.end();
        });

        console.log(`[OneNET API] 收到回應 - 狀態碼: ${response.statusCode}`);
        console.log(`[OneNET API] 回應內容: ${response.body}`);

        // 檢查OneNET API是否返回成功
        const success = response.statusCode >= 200 && response.statusCode < 300;

        // 嘗試解析回應為JSON
        let parsedBody = response.body;
        try {
            parsedBody = JSON.parse(response.body);
        } catch (e) {
            // 如果解析失敗，保持原始文本
        }

        res.status(response.statusCode).json({
            success: success,
            statusCode: response.statusCode,
            message: success ? 'OneNET連接成功' : 'OneNET連接失敗',
            onenetResponse: parsedBody,
            details: {
                timestamp: new Date().toISOString(),
                topic: topic
            }
        });

    } catch (error) {
        console.error('[OneNET API] 錯誤:', error.message);

        res.status(500).json({
            success: false,
            statusCode: 500,
            message: '代理服務錯誤: ' + error.message,
            error: error.toString()
        });
    }
});

/**
 * Token計算端點
 * POST /api/onenet/token
 */
app.post('/api/onenet/token', (req, res) => {
    try {
        const { productId, deviceName, deviceKey } = req.body;

        if (!productId || !deviceName || !deviceKey) {
            return res.status(400).json({
                success: false,
                message: '缺少必填參數: productId, deviceName, deviceKey'
            });
        }

        const token = calculateOneNETToken(productId, deviceName, deviceKey);

        res.json({
            success: true,
            token: token,
            expiresIn: 3600,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[Token計算] 錯誤:', error.message);

        res.status(500).json({
            success: false,
            message: '計算Token失敗: ' + error.message
        });
    }
});

/**
 * 發送數據到OneNET端點
 * POST /api/onenet/send-data
 */
app.post('/api/onenet/send-data', async (req, res) => {
    try {
        const { productId, deviceName, deviceKey, dataName, dataValue } = req.body;

        if (!productId || !deviceName || !deviceKey || !dataName || dataValue === undefined) {
            return res.status(400).json({
                success: false,
                statusCode: 400,
                message: '缺少必填參數: productId, deviceName, deviceKey, dataName, dataValue'
            });
        }

        console.log('\n[OneNET Send] 收到發送數據請求');
        console.log(`  產品ID: ${productId}`);
        console.log(`  設備名: ${deviceName}`);
        console.log(`  數據: ${dataName}=${dataValue}`);

        // 計算Token
        const token = calculateOneNETToken(productId, deviceName, deviceKey);

        // 生成Topic
        const topic = `$sys/${productId}/${deviceName}/thing/property/post`;

        // 準備請求體
        const requestBody = {
            "id": String(Math.floor(Math.random() * 10000)),
            "version": "1.0",
            "params": {
                [dataName]: {
                    "value": dataValue
                }
            }
        };

        // OneNET API信息
        const oneNetUrl = 'https://www.onenet.hk.chinamobile.com:20080/fuse/http/device/thing/property/post';

        // 準備請求選項
        const requestOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token,
                'params': `protocol:MQTT;topic:${encodeURIComponent(topic)}`
            }
        };

        console.log('[OneNET Send] 發送請求到OneNET...');

        // 發送請求到OneNET
        const response = await new Promise((resolve, reject) => {
            const request = https.request(oneNetUrl, requestOptions, (response) => {
                let responseData = '';

                response.on('data', (chunk) => {
                    responseData += chunk;
                });

                response.on('end', () => {
                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body: responseData
                    });
                });
            });

            request.on('error', (error) => {
                reject(error);
            });

            // 發送請求體
            request.write(JSON.stringify(requestBody));
            request.end();
        });

        console.log(`[OneNET Send] 收到回應 - 狀態碼: ${response.statusCode}`);

        // 檢查OneNET API是否返回成功
        const success = response.statusCode >= 200 && response.statusCode < 300;

        // 嘗試解析回應為JSON
        let parsedBody = response.body;
        try {
            parsedBody = JSON.parse(response.body);
        } catch (e) {
            // 如果解析失敗，保持原始文本
        }

        res.status(response.statusCode).json({
            success: success,
            statusCode: response.statusCode,
            message: success ? '數據發送成功' : '數據發送失敗',
            onenetResponse: parsedBody,
            details: {
                timestamp: new Date().toISOString(),
                topic: topic,
                data: requestBody
            }
        });

    } catch (error) {
        console.error('[OneNET Send] 錯誤:', error.message);

        res.status(500).json({
            success: false,
            statusCode: 500,
            message: '代理服務錯誤: ' + error.message,
            error: error.toString()
        });
    }
});

/**
 * 健康檢查端點
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'OneNET Proxy Server',
        timestamp: new Date().toISOString()
    });
});

/**
 * 根路由 - 提供歡迎信息
 */
app.get('/', (req, res) => {
    res.json({
        message: 'OneNET API 代理服務已啟動',
        endpoints: {
            health: 'GET /api/health',
            connect: 'POST /api/onenet/connect',
            token: 'POST /api/onenet/token',
            sendData: 'POST /api/onenet/send-data',
            frontend: 'GET /index.html'
        },
        documentation: 'https://github.com/chinamobile/OneNET'
    });
});

/**
 * 錯誤處理中間件
 */
app.use((error, req, res, next) => {
    console.error('服務器錯誤:', error);

    res.status(500).json({
        success: false,
        statusCode: 500,
        message: '服務器內部錯誤',
        error: error.message
    });
});

/**
 * 啟動服務器
 */
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`OneNET API 代理服務已啟動`);
    console.log(`========================================`);
    console.log(`服務器地址: http://localhost:${PORT}`);
    console.log(`前端: http://localhost:${PORT}/index.html`);
    console.log(`\n可用API端點:`);
    console.log(`  健康檢查: GET /api/health`);
    console.log(`  連接OneNET: POST /api/onenet/connect`);
    console.log(`  計算Token: POST /api/onenet/token`);
    console.log(`  發送數據: POST /api/onenet/send-data`);
    console.log(`========================================\n`);
});

// 優雅關閉
process.on('SIGTERM', () => {
    console.log('\n服務器正在關閉...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n收到中斷信號，正在關閉...');
    process.exit(0);
});
