from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os
from dotenv import load_dotenv

# Default to config.env but fallback to .env if missing
if os.path.exists('config.env'):
    load_dotenv('config.env')
else:
    load_dotenv()

app = Flask(__name__, static_folder='.', static_url_path='')
# Enable CORS for the frontend
CORS(app)

# Store API credentials
KAKAO_JS_KEY = os.environ.get('KAKAO_JS_KEY')
KAKAO_REST_KEY = os.environ.get('KAKAO_REST_KEY')


@app.route('/api/config', methods=['GET'])
def get_config():
    # Return only the JS Key for the map SDK. 
    # REST API Key is kept on the server for security. 
    return jsonify({
        'KAKAO_JS_KEY': KAKAO_JS_KEY
    }), 200

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/api/directions', methods=['GET'])
def get_directions():
    origin = request.args.get('start') # "lng,lat"
    destination = request.args.get('goal') # "lng,lat"
    waypoints = request.args.get('waypoints') # "lng,lat|lng,lat"
    
    # REST API Key should be passed in headers
    client_secret = request.headers.get('X-NCP-APIGW-API-KEY', KAKAO_REST_KEY)

    if not origin or not destination:
        return jsonify({'error': 'start and goal are required'}), 400

    # Kakao Mobility Directions API
    url = 'https://apis-navi.kakaomobility.com/v1/directions'
    
    # Kakao uses '|' for waypoints, same as Naver, but param name is 'waypoints'
    params = {
        'origin': origin,
        'destination': destination,
        'priority': 'RECOMMEND'
    }
    
    if waypoints:
        params['waypoints'] = waypoints

    headers = {
        'Authorization': f'KakaoAK {client_secret}'
    }

    try:
        response = requests.get(url, params=params, headers=headers)
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/search', methods=['GET'])
def search_places():
    query = request.args.get('query')
    if not query:
        return jsonify({'error': 'query is required'}), 400

    client_secret = request.headers.get('X-NCP-APIGW-API-KEY', KAKAO_REST_KEY)
    print(f"DEBUG: Search query received: {query}")
    print(f"DEBUG: Using REST API Key: {client_secret[:5]}...")

    # 1. Try Keyword Search first
    keyword_url = 'https://dapi.kakao.com/v2/local/search/keyword.json'
    headers = {'Authorization': f'KakaoAK {client_secret}'}
    
    documents = []
    try:
        kw_res = requests.get(keyword_url, params={'query': query}, headers=headers)
        if kw_res.status_code == 200:
            documents.extend(kw_res.json().get('documents', []))
        
        # 2. Try Address Search fallback (Continue if results < 5)
        if len(documents) < 5:
            addr_url = 'https://dapi.kakao.com/v2/local/search/address.json'
            ad_res = requests.get(addr_url, params={'query': query}, headers=headers)
            if ad_res.status_code == 200:
                ad_data = ad_res.json()
                for ad in ad_data.get('documents', []):
                    # Coordinate-based de-duplication
                    if not any(abs(float(d['x']) - float(ad['x'])) < 0.0001 and abs(float(d['y']) - float(ad['y'])) < 0.0001 for d in documents):
                        documents.append({
                            'place_name': ad.get('address_name'),
                            'address_name': ad.get('address_name'),
                            'road_address_name': ad.get('road_address', {}).get('address_name', ''),
                            'x': ad.get('x'),
                            'y': ad.get('y'),
                            'category_group_name': '주소/건물'
                        })
            
        # 3. Business Suffix Fallback (Continue if results < 5)
        if len(documents) < 5:
            first_word = query.split()[0]
            suffixes = ['공장', '본사', '지점', '사무소', '연구소', '물류', '센터']
            for suffix in suffixes:
                if len(documents) >= 10: break
                s_query = f"{first_word} {suffix}"
                s_res = requests.get(keyword_url, params={'query': s_query}, headers=headers)
                if s_res.status_code == 200:
                    s_data = s_res.json()
                    other_parts = query.split()[1:]
                    for doc in s_data.get('documents', []):
                        full_text = (doc['place_name'] + ' ' + doc['address_name'] + ' ' + doc.get('road_address_name', '')).lower()
                        if all(p.lower() in full_text for p in other_parts):
                            if not any(abs(float(d['x']) - float(doc['x'])) < 0.0001 and abs(float(d['y']) - float(doc['y'])) < 0.0001 for d in documents):
                                documents.append(doc)


        return jsonify({'documents': documents, 'meta': {'total_count': len(documents)}}), 200
        
    except Exception as e:
        print(f"DEBUG: Search Error: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Use 0.0.0.0 to listen on all interfaces (Required for Render)
    # Use PORT env variable if available (Required for Render)
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting Visit Scheduler API Proxy Server on port {port}")
    app.run(host='0.0.0.0', port=port, debug=True)

