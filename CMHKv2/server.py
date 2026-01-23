"""
OneNET API 代理服務器 - Python/Flask 版本
用於解決CORS跨域限制問題

使用方法：
1. 安裝依賴：pip install flask flask-cors requests crypto-js
   或 pip install -r requirements.txt
2. 啟動服務器：python server.py
3. 服務器將在 http://localhost:3000 運行
"""

import os
import json
import hmac
import hashlib
import base64
import time
import requests
from datetime import datetime
from urllib.parse import quote
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)  # 啟用CORS

PORT = int(os.environ.get('PORT', 3000))
ONENET_API_URL = 'https://www.onenet.hk.chinamobile.com:20080/fuse/http/device/thing/property/post'


def calculate_onenet_token(product_id, device_key):
    """
    計算OneNET Token
    
    Args:
        product_id (str): 產品ID
        device_key (str): 設備Key（Base64編碼）
    
    Returns:
        str: 計算出的Token字符串
    """
    try:
        version = '2018-10-31'
        res = f'products/{product_id}'
        timestamp = int(time.time())
        et = str(timestamp + 3600)  # 1小時有效期
        method = 'md5'
        
        # 簽名字符串
        sign_string = f'{et}\n{method}\n{res}\n{version}'
        
        # 將deviceKey從Base64解碼
        key = base64.b64decode(device_key)
        
        # 計算HMAC-MD5
        sign = base64.b64encode(
            hmac.new(key, sign_string.encode(), hashlib.md5).digest()
        ).decode()
        
        # URL編碼簽名和資源路徑
        encoded_sign = quote(sign, safe='')
        encoded_res = quote(res, safe='')
        
        # 拼接Token
        token = f'version={version}&res={encoded_res}&et={et}&method={method}&sign={encoded_sign}'
        
        print(f'[Token計算] 成功生成Token')
        print(f'  產品ID: {product_id}')
        print(f'  過期時間: {et}')
        
        return token
    
    except Exception as e:
        print(f'[Token計算] 失敗: {str(e)}')
        raise Exception(f'Token計算失敗: {str(e)}')


@app.route('/api/onenet/connect', methods=['POST'])
def onenet_connect():
    """
    OneNET API 連接端點
    POST /api/onenet/connect
    """
    try:
        data = request.get_json()
        
        token = data.get('token')
        topic = data.get('topic')
        payload = data.get('data')
        
        if not token or not topic or not payload:
            return jsonify({
                'success': False,
                'statusCode': 400,
                'message': '缺少必填參數: token, topic, data'
            }), 400
        
        print(f'\n[OneNET API] 收到連接請求')
        print(f'  Topic: {topic}')
        print(f'  Token: {token[:50]}...')
        print(f'  數據: {json.dumps(payload)}')
        
        # 準備URL查詢參數
        # 根據OneNET API文檔：
        # - Header Parameters: token, Content-Type
        # - Request Parameters: topic, protocol
        query_params = {
            'protocol': 'MQTT',
            'topic': topic
        }
        
        # 準備請求頭（只需要两个header）
        headers = {
            'Content-Type': 'application/json',
            'token': token
        }
        
        print(f'[OneNET API] 發送請求...')
        print(f'  URL: {ONENET_API_URL}')
        print(f'  Headers:')
        print(f'    Content-Type: {headers["Content-Type"]}')
        print(f'    token: {token[:30]}... (共{len(token)}字符)')
        print(f'  Query Parameters:')
        print(f'    protocol: MQTT')
        print(f'    topic: {topic}')
        print(f'  Body: {json.dumps(payload)}')
        
        # 發送請求到OneNET
        try:
            response = requests.post(
                ONENET_API_URL,
                params=query_params,
                json=payload,
                headers=headers,
                timeout=10,
                verify=False  # 禁用SSL驗證（開發環境）
            )
        except requests.exceptions.SSLError:
            # 如果SSL驗證失敗，重試不驗證SSL
            response = requests.post(
                ONENET_API_URL,
                params=query_params,
                json=payload,
                headers=headers,
                timeout=10,
                verify=False
            )
        
        print(f'[OneNET API] 收到回應 - 狀態碼: {response.status_code}')
        print(f'[OneNET API] 回應內容: {response.text}')
        
        # 檢查OneNET API是否返回成功
        success = 200 <= response.status_code < 300
        
        # 嘗試解析回應為JSON
        try:
            parsed_body = response.json()
        except:
            parsed_body = response.text
        
        return jsonify({
            'success': success,
            'statusCode': response.status_code,
            'message': '連接成功' if success else '連接失敗',
            'onenetResponse': parsed_body,
            'details': {
                'timestamp': datetime.now().isoformat(),
                'topic': topic
            }
        }), response.status_code
    
    except Exception as e:
        print(f'[OneNET API] 錯誤: {str(e)}')
        return jsonify({
            'success': False,
            'statusCode': 500,
            'message': f'代理服務錯誤: {str(e)}',
            'error': str(e)
        }), 500


@app.route('/api/onenet/token', methods=['POST'])
def onenet_token():
    """
    Token計算端點
    POST /api/onenet/token
    """
    try:
        data = request.get_json()
        
        product_id = data.get('productId')
        device_key = data.get('deviceKey')
        
        if not product_id or not device_key:
            return jsonify({
                'success': False,
                'message': '缺少必填參數: productId, deviceKey'
            }), 400
        
        token = calculate_onenet_token(product_id, device_key)
        
        return jsonify({
            'success': True,
            'token': token,
            'expiresIn': 3600,
            'timestamp': datetime.now().isoformat()
        })
    
    except Exception as e:
        print(f'[Token計算] 錯誤: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'計算Token失敗: {str(e)}'
        }), 500


@app.route('/api/onenet/send-data', methods=['POST'])
def onenet_send_data():
    """
    發送數據到OneNET端點
    POST /api/onenet/send-data
    """
    try:
        data = request.get_json()
        
        product_id = data.get('productId')
        device_name = data.get('deviceName')
        device_key = data.get('deviceKey')
        data_name = data.get('dataName')
        data_value = data.get('dataValue')
        
        if not all([product_id, device_name, device_key, data_name, data_value is not None]):
            return jsonify({
                'success': False,
                'statusCode': 400,
                'message': '缺少必填參數: productId, deviceName, deviceKey, dataName, dataValue'
            }), 400
        
        print(f'\n[OneNET Send] 收到發送數據請求')
        print(f'  產品ID: {product_id}')
        print(f'  設備名: {device_name}')
        print(f'  數據: {data_name}={data_value}')
        
        # 計算Token
        token = calculate_onenet_token(product_id, device_key)
        
        # 生成Topic
        topic = f'$sys/{product_id}/{device_name}/thing/property/post'
        
        # 準備請求體
        request_body = {
            'id': str(int(time.time() * 1000) % 10000),
            'version': '1.0',
            'params': {
                data_name: {
                    'value': data_value
                }
            }
        }
        
        # 準備請求頭
        headers = {
            'Content-Type': 'application/json',
            'token': token,
            'params': f'protocol:MQTT;topic:{quote(topic, safe="")}'
        }
        
        print(f'[OneNET Send] 發送請求到OneNET...')
        
        # 發送請求到OneNET
        try:
            response = requests.post(
                ONENET_API_URL,
                json=request_body,
                headers=headers,
                timeout=10,
                verify=False
            )
        except requests.exceptions.SSLError:
            response = requests.post(
                ONENET_API_URL,
                json=request_body,
                headers=headers,
                timeout=10,
                verify=False
            )
        
        print(f'[OneNET Send] 收到回應 - 狀態碼: {response.status_code}')
        
        # 檢查OneNET API是否返回成功
        success = 200 <= response.status_code < 300
        
        # 嘗試解析回應為JSON
        try:
            parsed_body = response.json()
        except:
            parsed_body = response.text
        
        return jsonify({
            'success': success,
            'statusCode': response.status_code,
            'message': '數據發送成功' if success else '數據發送失敗',
            'onenetResponse': parsed_body,
            'details': {
                'timestamp': datetime.now().isoformat(),
                'topic': topic,
                'data': request_body
            }
        }), response.status_code
    
    except Exception as e:
        print(f'[OneNET Send] 錯誤: {str(e)}')
        return jsonify({
            'success': False,
            'statusCode': 500,
            'message': f'代理服務錯誤: {str(e)}',
            'error': str(e)
        }), 500


@app.route('/api/health', methods=['GET'])
def health_check():
    """
    健康檢查端點
    GET /api/health
    """
    return jsonify({
        'status': 'OK',
        'service': 'OneNET Proxy Server',
        'timestamp': datetime.now().isoformat()
    })


@app.route('/', methods=['GET'])
def index():
    """
    根路由 - 提供歡迎信息
    """
    return jsonify({
        'message': 'OneNET API 代理服務已啟動',
        'endpoints': {
            'health': 'GET /api/health',
            'connect': 'POST /api/onenet/connect',
            'token': 'POST /api/onenet/token',
            'sendData': 'POST /api/onenet/send-data',
            'frontend': 'GET /index.html'
        },
        'documentation': 'https://github.com/chinamobile/OneNET'
    })


@app.route('/index.html')
def serve_frontend():
    """提供前端HTML文件"""
    return app.send_static_file('index.html')


@app.errorhandler(500)
def internal_error(error):
    """錯誤處理"""
    print(f'服務器錯誤: {str(error)}')
    return jsonify({
        'success': False,
        'statusCode': 500,
        'message': '服務器內部錯誤',
        'error': str(error)
    }), 500


if __name__ == '__main__':
    print(f'\n========================================')
    print(f'OneNET API 代理服務已啟動')
    print(f'========================================')
    print(f'服務器地址: http://localhost:{PORT}')
    print(f'前端: http://localhost:{PORT}/index.html')
    print(f'\n可用API端點:')
    print(f'  健康檢查: GET /api/health')
    print(f'  連接OneNET: POST /api/onenet/connect')
    print(f'  計算Token: POST /api/onenet/token')
    print(f'  發送數據: POST /api/onenet/send-data')
    print(f'========================================\n')
    
    app.run(host='0.0.0.0', port=PORT, debug=False)
