/**
 * 협력기업 방문 일정 수립 - 메인 앱 로직
 * 카카오 지도 API 연동 + 경유지 관리 + 경로 계산
 */

(function () {
    'use strict';

    // ===== State =====
    const state = {
        apiKey: localStorage.getItem('kakao_js_key') || '',
        apiSecret: localStorage.getItem('kakao_rest_key') || '',

        departureTime: '09:00',
        contacts: {}, // { id: "text" }
        customNames: {}, // { id: "custom display name" }
        segmentBreaks: {}, // { "fromName-toName": minutes }
        segmentRemarks: {}, // { "fromName-toName": text }
        lastSegments: [], 
        mapLoaded: false,
        map: null,
        markers: [],
        polylines: [],
        departure: null,   // { name, address, lat, lng }
        arrival: null,
        waypoints: [],      // [{ id, name, address, lat, lng }]
        waypointCounter: 0,
        searchTimeout: null
    };

    // ===== DOM References =====
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const els = {
        apiKeyModal: $('#apiKeyModal'),
        apiKeyInput: $('#apiKeyInput'),
        apiSecretInput: $('#apiSecretInput'),
        saveApiKeyBtn: $('#saveApiKeyBtn'),
        skipApiKeyBtn: $('#skipApiKeyBtn'),
        apiKeySettingBtn: $('#apiKeySettingBtn'),
        departureInput: $('#departureInput'),
        departureDropdown: $('#departureDropdown'),
        departureInfo: $('#departureInfo'),
        arrivalInput: $('#arrivalInput'),
        arrivalDropdown: $('#arrivalDropdown'),
        arrivalInfo: $('#arrivalInfo'),
        waypointsContainer: $('#waypointsContainer'),
        addWaypointBtn: $('#addWaypointBtn'),
        calcRouteBtn: $('#calcRouteBtn'),
        optimizeBtn: $('#optimizeBtn'),
        departureTimeInput: $('#departureTime'),
        resetBtn: $('#resetBtn'),
        itineraryPanel: $('#itineraryPanel'),
        itineraryContainer: $('#itineraryContainer'),
        mapPlaceholder: $('#mapPlaceholder'),
        mapContainer: $('#mapContainer'),
        passwordModal: $('#passwordModal'),
        adminPasswordInput: $('#adminPasswordInput'),
        verifyPasswordBtn: $('#verifyPasswordBtn'),
        closePasswordBtn: $('#closePasswordBtn'),
        toast: $('#toast'),
        // Save schedule
        saveScheduleBtn: $('#saveScheduleBtn'),
        saveScheduleModal: $('#saveScheduleModal'),
        scheduleNameInput: $('#scheduleNameInput'),
        confirmSaveBtn: $('#confirmSaveBtn'),
        savedSchedulesList: $('#savedSchedulesList')
    };

    // ===== Init =====
    async function init() {
        setupEventListeners();
        setupEnterpriseUI();
        initDragAndDrop();
        initCopy();
        initSaveSchedule();
        loadEnterpriseDirectory();
        renderSavedSchedules();

        // 1. Try to fetch config from the server (Real Dev Server mode)
        try {
            const res = await fetch('/api/config');
            if (res.ok) {
                const config = await res.json();
                if (config.KAKAO_JS_KEY) {
                    state.apiKey = config.KAKAO_JS_KEY;
                    console.log("✅ Server API Key loaded automatically.");
                }
            }
        } catch (e) {
            console.log("ℹ️ No server config found, using manual entry or localStorage.");
        }

        // 2. If we have a key (from server or localStorage), go ahead
        if (state.apiKey) {
            hideModal();
            loadKakaoMapScript();
        }
    }


    // ===== Event Listeners =====
    function setupEventListeners() {
        els.saveApiKeyBtn.addEventListener('click', saveApiKey);
        els.skipApiKeyBtn.addEventListener('click', () => {
            hideModal();
            showToast('🗺️ 데모 모드로 실행합니다. 경유지 추가/삭제를 테스트해보세요!');
        });
        els.apiKeySettingBtn.addEventListener('click', showPasswordModal);
        els.verifyPasswordBtn.addEventListener('click', verifyAdminPassword);
        els.closePasswordBtn.addEventListener('click', hidePasswordModal);
        
        // Keydown support for password input
        els.adminPasswordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') verifyAdminPassword();
        });

        els.addWaypointBtn.addEventListener('click', addWaypoint);
        els.calcRouteBtn.addEventListener('click', calculateRoute);
        els.optimizeBtn.addEventListener('click', optimizeRoute);
        els.resetBtn.addEventListener('click', resetAll);

        // Departure search
        setupSearch(els.departureInput, els.departureDropdown, (place) => {
            state.departure = place;
            if (els.departureInput._setSearchValue) {
                els.departureInput._setSearchValue(place.name);
            } else {
                els.departureInput.value = place.name;
            }
            els.departureInput.classList.add('has-value');
            els.departureInfo.textContent = place.address;
            els.departureInfo.classList.add('has-info');
            updateButtonStates();
            updateMap();
        });

        // Arrival search
        setupSearch(els.arrivalInput, els.arrivalDropdown, (place) => {
            state.arrival = place;
            if (els.arrivalInput._setSearchValue) {
                els.arrivalInput._setSearchValue(place.name);
            } else {
                els.arrivalInput.value = place.name;
            }
            els.arrivalInput.classList.add('has-value');
            els.arrivalInfo.textContent = place.address;
            els.arrivalInfo.classList.add('has-info');
            updateButtonStates();
            updateMap();
        });

        // Close dropdowns on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-wrapper')) {
                $$('.search-dropdown').forEach(d => d.classList.remove('active'));
            }
        });
    }

    // ===== API Key =====
    function saveApiKey() {
        const key = els.apiKeyInput.value.trim();
        const secret = els.apiSecretInput.value.trim();
        if (key && secret) {
            state.apiKey = key;
            state.apiSecret = secret;
            localStorage.setItem('kakao_js_key', key);
            localStorage.setItem('kakao_rest_key', secret);
            hideModal();
            loadKakaoMapScript();
            showToast('✅ API Key 및 Secret이 저장되었습니다!');
        } else {
            showToast('⚠️ JavaScript 키와 REST API 키를 모두 입력해주세요.');
        }
    }

    function hideModal() {
        els.apiKeyModal.classList.add('hidden');
    }

    function showModal() {
        els.apiKeyModal.classList.remove('hidden');
        els.apiKeyInput.value = state.apiKey;
        els.apiSecretInput.value = state.apiSecret;
        setTimeout(() => els.apiKeyInput.focus(), 300);
    }

    // ===== Admin Password =====
    function showPasswordModal() {
        els.passwordModal.classList.remove('hidden');
        els.adminPasswordInput.value = '';
        setTimeout(() => els.adminPasswordInput.focus(), 300);
    }

    function hidePasswordModal() {
        els.passwordModal.classList.add('hidden');
    }

    function verifyAdminPassword() {
        const pw = els.adminPasswordInput.value;
        if (pw === 'pmo1234!') {
            hidePasswordModal();
            showModal();
        } else {
            showToast('❌ 비밀번호가 틀렸습니다.');
            els.adminPasswordInput.value = '';
            els.adminPasswordInput.focus();
        }
    }

    // ===== Kakao Map =====
    function loadKakaoMapScript() {
        if (state.mapLoaded || !state.apiKey) return;
        const script = document.createElement('script');
        // Kakao Maps API with autoload=false
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${state.apiKey}&autoload=false&libraries=services`;
        script.onload = () => {
            kakao.maps.load(() => {
                state.mapLoaded = true;
                initMap();
            });
        };
        script.onerror = () => {
            showToast('❌ 지도 로드에 실패했습니다. JavaScript 키와 [플랫폼 > Web] 도메인 등록을 확인해주세요.');
        };
        document.head.appendChild(script);
    }

    function initMap() {
        if (!window.kakao || !window.kakao.maps) return;
        els.mapPlaceholder.style.display = 'none';
        const mapOption = {
            center: new kakao.maps.LatLng(37.3595704, 127.105399),
            level: 5 // Kakao zoom level (smaller = closer)
        };
        state.map = new kakao.maps.Map(els.mapContainer, mapOption);

        // Add zoom control
        const zoomControl = new kakao.maps.ZoomControl();
        state.map.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);
    }

    function updateMap() {
        if (!state.map) return;
        clearMapObjects();
        const points = getAllPoints();
        if (points.length === 0) return;

        const bounds = new kakao.maps.LatLngBounds();

        points.forEach((p, i) => {
            const pos = new kakao.maps.LatLng(p.lat, p.lng);
            bounds.extend(pos);
            const isFirst = i === 0;
            const isLast = i === points.length - 1;

            // Custom marker using CustomOverlay
            const content = `
                <div style="
                    background:${isFirst ? '#2ecc71' : isLast ? '#e74c3c' : '#3498db'};
                    color:#fff; font-weight:700; font-size:12px;
                    width:28px; height:28px; border-radius:50%;
                    display:flex; align-items:center; justify-content:center;
                    box-shadow:0 2px 8px rgba(0,0,0,0.3);
                    border:2px solid #fff;">${i + 1}</div>`;

            const overlay = new kakao.maps.CustomOverlay({
                position: pos,
                content: content,
                map: state.map,
                yAnchor: 0.5
            });
            state.markers.push(overlay);
        });

        // Draw polylines between consecutive points
        if (points.length >= 2) {
            const path = points.map(p => new kakao.maps.LatLng(p.lat, p.lng));
            const polyline = new kakao.maps.Polyline({
                map: state.map,
                path: path,
                strokeColor: '#2ecc71',
                strokeWeight: 3,
                strokeOpacity: 0.8,
                strokeStyle: 'shortdash'
            });
            state.polylines.push(polyline);
        }

        state.map.setBounds(bounds);
    }

    function clearMapObjects() {
        state.markers.forEach(m => m.setMap(null));
        state.polylines.forEach(p => p.setMap(null));
        state.markers = [];
        state.polylines = [];
    }

    function getAllPoints() {
        const points = [];
        if (state.departure) points.push(state.departure);
        state.waypoints.forEach(wp => {
            if (wp.lat && wp.lng) points.push(wp);
        });
        if (state.arrival) points.push(state.arrival);
        return points;
    }

    // ===== Search =====
    function setupSearch(input, dropdown, onSelect) {
        let debounceTimer;
        let lastValue = input.value;

        // Expose a way to update lastValue when selection is made programmatically
        input._setSearchValue = (val) => {
            lastValue = val;
            input.value = val;
        };

        input.addEventListener('input', () => {
            const query = input.value.trim();
            if (query === lastValue) return; 
            
            if (query.length < 2) {
                dropdown.classList.remove('active');
                clearTimeout(debounceTimer);
                return;
            }
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                lastValue = query;
                searchPlaces(query, dropdown, onSelect);
            }, 300);
        });

        input.addEventListener('focus', () => {
            if (dropdown.children.length > 0) {
                dropdown.classList.add('active');
            }
        });
    }

    // ===== 기업 주소록 (JSON 파일 + 서버 API 병합) =====
    let ENTERPRISE_DIRECTORY = [];
    let CUSTOM_ENTERPRISE_DIRECTORY = [];

    // Load enterprise directory from JSON + Server API
    async function loadEnterpriseDirectory() {
        // 1. Load from JSON file (base directory)
        try {
            const res = await fetch('enterprise_directory.json');
            if (res.ok) {
                const data = await res.json();
                ENTERPRISE_DIRECTORY = data.filter(e => e.lat !== 0 && e.lng !== 0);
                console.log(`[기업주소록] 기본 DB에서 ${ENTERPRISE_DIRECTORY.length}건 로드`);
            }
        } catch (e) {
            console.warn('[기업주소록] 기본 DB 로드 실패', e);
        }

        // 2. Merge with Server API (Shared custom entries)
        try {
            const res = await fetch('/api/custom-enterprise');
            if (res.ok) {
                CUSTOM_ENTERPRISE_DIRECTORY = await res.json();
                console.log(`[기업주소록] 서버에서 ${CUSTOM_ENTERPRISE_DIRECTORY.length}건 동기화`);
                
                CUSTOM_ENTERPRISE_DIRECTORY.forEach(entry => {
                    const exists = ENTERPRISE_DIRECTORY.some(e => 
                        e.name === entry.name && e.address === entry.address
                    );
                    if (!exists) ENTERPRISE_DIRECTORY.push(entry);
                });
            }
        } catch (e) {
            console.log("ℹ️ 서버 주소록 동기화 실패 (기본값 사용)");
        }
    }

    // Enterprise Management UI
    function setupEnterpriseUI() {
        const btn = document.getElementById('enterpriseBtn');
        const modal = document.getElementById('enterpriseModal');
        const addBtn = document.getElementById('addEnterpriseBtn');
        if (!btn || !modal) return;

        btn.addEventListener('click', () => {
            modal.classList.remove('hidden');
            renderEnterpriseList();
        });

        addBtn.addEventListener('click', async () => {
            const nameInput = document.getElementById('entNameInput');
            const addrInput = document.getElementById('entAddressInput');
            const catInput = document.getElementById('entCategoryInput');
            const name = nameInput.value.trim();
            const address = addrInput.value.trim();
            const category = catInput.value.trim() || '협력사';

            if (!name || !address) {
                showToast('⚠️ 업체명과 주소를 모두 입력해주세요.');
                return;
            }

            showToast('🔍 주소에서 좌표를 찾는 중...');

            // Geocode the address using Kakao SDK
            let lat = 0, lng = 0;
            try {
                const coords = await geocodeAddress(address);
                lat = coords.lat;
                lng = coords.lng;
            } catch (e) {
                showToast('⚠️ 주소 좌표 변환 실패. 주소를 확인해주세요.');
                return;
            }

            const entry = { name, address, lat, lng, category };
            
            // Save to Server
            try {
                const res = await fetch('/api/custom-enterprise', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(entry)
                });
                if (res.ok) {
                    showToast(`✅ "${name}" 전용 주소록에 동기화 완료!`);
                }
            } catch (e) {
                console.warn('서버 저장 실패, 로컬에만 추가됨', e);
            }
            
            // Update runtime directory (to reflect immediately)
            const exists = ENTERPRISE_DIRECTORY.some(e => 
                e.name === entry.name && e.address === entry.address
            );
            if (!exists) {
                ENTERPRISE_DIRECTORY.push(entry);
                CUSTOM_ENTERPRISE_DIRECTORY.push(entry);
            }

            // Clear inputs
            nameInput.value = '';
            addrInput.value = '';
            catInput.value = '';

            renderEnterpriseList();
        });
    }

    function geocodeAddress(address) {
        return new Promise((resolve, reject) => {
            if (window.kakao?.maps?.services) {
                const geocoder = new kakao.maps.services.Geocoder();
                geocoder.addressSearch(address, (result, status) => {
                    if (status === kakao.maps.services.Status.OK && result.length > 0) {
                        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
                    } else {
                        reject(new Error('Geocode failed'));
                    }
                });
            } else {
                // Fallback: use REST API via proxy
                fetch(`http://127.0.0.1:5000/api/search?query=${encodeURIComponent(address)}`)
                    .then(r => r.json())
                    .then(data => {
                        if (data.documents?.length) {
                            resolve({ lat: parseFloat(data.documents[0].y), lng: parseFloat(data.documents[0].x) });
                        } else reject(new Error('No results'));
                    })
                    .catch(reject);
            }
        });
    }

    function renderEnterpriseList() {
        const list = document.getElementById('enterpriseList');
        if (!list) return;
        
        const stored = CUSTOM_ENTERPRISE_DIRECTORY;
        const storedKeys = new Set(stored.map(e => `${e.name}|${e.address}`));
        
        let html = `<div style="font-size:0.8rem; color:#8b8fa3; margin-bottom:0.8rem; padding: 10px; background: rgba(52, 152, 219, 0.1); border-radius: 8px; border-left: 4px solid var(--accent-blue);">
            전체 ${ENTERPRISE_DIRECTORY.length}건의 업체 리스트를 공유하고 있습니다.<br>
            <span style="color:var(--accent-green)">사용자 추가: ${stored.length}건</span>
        </div>`;
        
        // Show user-added entries first (deletable)
        if (stored.length > 0) {
            html += '<div style="margin-bottom:0.5rem; font-size:0.75rem; color:var(--accent-green); font-weight:600;">📌 사용자 추가 업체</div>';
            stored.forEach((entry, i) => {
                html += `<div style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px; margin-bottom:4px; background:rgba(255,255,255,0.03); border-radius:6px; font-size:0.8rem;">
                    <div>
                        <strong>${entry.name}</strong>
                        <div style="color:#8b8fa3; font-size:0.7rem;">${entry.address}</div>
                    </div>
                    <button onclick="window._deleteEnterprise(${i})" style="background:none; border:none; color:#e74c3c; cursor:pointer; font-size:1rem; padding:2px 6px;" title="삭제">✕</button>
                </div>`;
            });
        }
        
        // Show base entries (not deletable, collapsible)
        const baseCount = ENTERPRISE_DIRECTORY.length - stored.length;
        html += `<details style="margin-top:0.5rem;">
            <summary style="cursor:pointer; font-size:0.75rem; color:#8b8fa3; padding:4px 0;">📋 기본 등록 업체 (${baseCount}건) 펼쳐보기</summary>
            <div style="max-height:200px; overflow-y:auto; margin-top:4px;">`;
        ENTERPRISE_DIRECTORY.forEach(entry => {
            if (!storedKeys.has(`${entry.name}|${entry.address}`)) {
                html += `<div style="padding:4px 8px; font-size:0.75rem; border-bottom:1px solid rgba(255,255,255,0.05);">
                    <strong>${entry.name}</strong> <span style="color:#8b8fa3;">${entry.address.substring(0, 25)}...</span>
                </div>`;
            }
        });
        html += '</div></details>';
        
        list.innerHTML = html;
    }

    // Global delete function for enterprise entries
    window._deleteEnterprise = async function(index) {
        const removed = CUSTOM_ENTERPRISE_DIRECTORY[index];
        if (!removed) return;

        if (!confirm(`"${removed.name}" 업체를 삭제하시겠습니까? (팀원 전체에게서 삭제됩니다.)`)) {
            return;
        }

        // 1. Delete from Server
        try {
            await fetch(`/api/custom-enterprise?name=${encodeURIComponent(removed.name)}&address=${encodeURIComponent(removed.address)}`, {
                method: 'DELETE'
            });
        } catch (e) {
            console.warn('서버 삭제 실패', e);
        }

        // 2. Remove from runtime directories
        CUSTOM_ENTERPRISE_DIRECTORY.splice(index, 1);
        ENTERPRISE_DIRECTORY = ENTERPRISE_DIRECTORY.filter(e => 
            !(e.name === removed.name && e.address === removed.address)
        );
        
        showToast(`🗑️ "${removed.name}" 삭제됨`);
        renderEnterpriseList();
    };

    async function searchPlaces(query, dropdown, onSelect) {
        console.log(`[검색 시작] "${query}"`);
        dropdown.innerHTML = '<div class="dropdown-item" style="pointer-events:none; color:var(--text-muted)">🔍 검색 중...</div>';
        dropdown.classList.add('active');

        let allResults = [];
        const seenKeys = new Set();

        const addResult = (item) => {
            const key = `${item.lat.toFixed(5)},${item.lng.toFixed(5)}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                allResults.push(item);
            }
        };

        // ★ 1단계: 기업 주소록에서 먼저 검색 (API 미등록 사업장 보완)
        const q = query.toLowerCase();
        ENTERPRISE_DIRECTORY.forEach(entry => {
            if (entry.name.toLowerCase().includes(q) || entry.address.toLowerCase().includes(q) || q.includes(entry.name.toLowerCase())) {
                addResult({ ...entry });
            }
        });
        console.log(`[검색] 기업주소록에서 ${allResults.length}건 발견`);

        // ★ 2단계: 카카오 SDK 키워드 검색
        const kSearch = (searchQuery) => new Promise(resolve => {
            if (!window.kakao?.maps?.services) {
                console.warn('[검색] 카카오 SDK 미로드');
                return resolve([]);
            }
            const timeout = setTimeout(() => {
                console.warn(`[검색] "${searchQuery}" 타임아웃`);
                resolve([]);
            }, 5000);
            const ps = new kakao.maps.services.Places();
            ps.keywordSearch(searchQuery, (data, status) => {
                clearTimeout(timeout);
                console.log(`[검색] SDK "${searchQuery}" 상태: ${status}, 결과: ${data ? data.length : 0}건`);
                if (status === kakao.maps.services.Status.OK) {
                    resolve(data);
                } else {
                    resolve([]);
                }
            }, { size: 15 });
        });

        const sdkResults = await kSearch(query);
        sdkResults.forEach(item => {
            addResult({
                name: item.place_name,
                address: item.road_address_name || item.address_name,
                lat: parseFloat(item.y),
                lng: parseFloat(item.x),
                category: item.category_group_name || '기타'
            });
        });
        console.log(`[검색] SDK 키워드에서 ${sdkResults.length}건 발견, 총 ${allResults.length}건`);

        // ★ 3단계: 결과 렌더링
        dropdown.innerHTML = '';
        if (allResults.length > 0) {
            // 정확한 이름 매칭 우선
            allResults.sort((a, b) => {
                const aExact = a.name.toLowerCase() === q;
                const bExact = b.name.toLowerCase() === q;
                if (aExact && !bExact) return -1;
                if (!aExact && bExact) return 1;
                return 0;
            });
            allResults.slice(0, 15).forEach(place => {
                dropdown.appendChild(createDropdownItem(place, onSelect, dropdown));
            });
            dropdown.classList.add('active');
        } else {
            showDemoResults(query, dropdown, onSelect, true);
        }
    }

    // Demo results when API is not available or search fails
    function showDemoResults(query, dropdown, onSelect, isZeroResult) {
        const demoPlaces = [
            { name: '풀무원 본사', address: '서울특별시 강남구 테헤란로 340', category: '기업 본사', lat: 37.5085, lng: 127.0622 },
            { name: '풀무원 오송연구소', address: '충남 천안시 서북구 오송읍', category: '연구소', lat: 36.634, lng: 127.311 },
            { name: '서울식품공업', address: '충청북도 충주시 신니면', category: '제조공장', lat: 37.012, lng: 127.712 },
            { name: '수서역', address: '서울특별시 강남구 수서동', category: '교통', lat: 37.487, lng: 127.101 },
            { name: '서울역', address: '서울특별시 용산구 한강대로 405', category: '교통', lat: 37.554, lng: 126.971 },
        ];

        const filtered = demoPlaces.filter(p =>
            p.name.includes(query) || p.address.includes(query)
        );

        dropdown.innerHTML = '';
        if (filtered.length === 0) {
            const noResult = document.createElement('div');
            noResult.className = 'dropdown-item';
            noResult.style.pointerEvents = 'none';
            noResult.innerHTML = `
                <div class="dropdown-item-name" style="color:var(--text-muted)">검색 결과 없음</div>
                <div class="dropdown-item-address">${isZeroResult ? `'${query}'에 대한 실제 장소 결과가 없습니다.` : 'API Key를 설정하면 실제 장소를 검색할 수 있습니다.'}</div>
            `;
            dropdown.appendChild(noResult);
            
            // Show all common demo places as suggestion
            demoPlaces.slice(0, 5).forEach(place => {
                dropdown.appendChild(createDropdownItem(place, onSelect, dropdown));
            });
        } else {
            filtered.forEach(place => {
                dropdown.appendChild(createDropdownItem(place, onSelect, dropdown));
            });
        }
        dropdown.classList.add('active');
    }

    function createDropdownItem(place, onSelect, dropdown) {
        const div = document.createElement('div');
        div.className = 'dropdown-item';
        div.innerHTML = `
            <div class="dropdown-item-name">${place.name}</div>
            <div class="dropdown-item-address">${place.address}</div>
            ${place.category ? `<div class="dropdown-item-category">${place.category}</div>` : ''}
        `;
        div.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); // Prevent global click listener from interfering
            onSelect(place);
            dropdown.innerHTML = '';
            dropdown.classList.remove('active');
        });
        return div;
    }

    // ===== Waypoints =====
    function addWaypoint() {
        state.waypointCounter++;
        const id = 'wp_' + state.waypointCounter;
        const wpData = { id, name: '', address: '', lat: null, lng: null };
        state.waypoints.push(wpData);

        const wpEl = document.createElement('div');
        wpEl.className = 'route-item waypoint-item draggable';
        wpEl.dataset.waypointId = id;
        wpEl.setAttribute('draggable', 'true');
        wpEl.innerHTML = `
            <div class="drag-handle">⋮⋮</div>
            <div class="route-marker">
                <div class="marker-line marker-line-top"></div>
                <div class="marker-dot waypoint-dot"></div>
                <div class="marker-line"></div>
            </div>
            <div class="waypoint-input-group">
                <div class="waypoint-header">
                    <label>경유지 ${state.waypoints.length}</label>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <div class="time-input-wrapper">
                            <span>체류:</span>
                            <input type="number" class="stay-duration-input" value="60" min="0" step="10">
                            <span>분</span>
                        </div>
                        <button class="btn-remove-waypoint" data-id="${id}" title="삭제">✕</button>
                    </div>
                </div>
                <div class="search-wrapper">
                    <input type="text" class="location-input" placeholder="경유 장소를 검색하세요" autocomplete="off">
                    <div class="search-dropdown"></div>
                </div>
                <div class="location-info"></div>
            </div>
        `;

        els.waypointsContainer.appendChild(wpEl);

        // Setup search for this waypoint
        const wpInput = wpEl.querySelector('.location-input');
        const wpDropdown = wpEl.querySelector('.search-dropdown');
        const wpInfo = wpEl.querySelector('.location-info');

        setupSearch(wpInput, wpDropdown, (place) => {
            wpData.name = place.name;
            wpData.address = place.address;
            wpData.lat = place.lat;
            wpData.lng = place.lng;
            
            if (wpInput._setSearchValue) {
                wpInput._setSearchValue(place.name);
            } else {
                wpInput.value = place.name;
            }
            
            wpInput.classList.add('has-value');
            wpInfo.textContent = place.address;
            wpInfo.classList.add('has-info');
            updateButtonStates();
            updateMap();
        });

        // Remove button
        wpEl.querySelector('.btn-remove-waypoint').addEventListener('click', () => {
            removeWaypoint(id, wpEl);
        });

        updateButtonStates();
        renumberWaypoints(); // Added: ensure colors/labels are right
        wpInput.focus();
        showToast(`📍 경유지 ${state.waypointCounter}이(가) 추가되었습니다.`);
    }

    function removeWaypoint(id, el) {
        state.waypoints = state.waypoints.filter(wp => wp.id !== id);
        el.style.animation = 'slideIn 0.2s ease reverse';
        setTimeout(() => {
            el.remove();
            renumberWaypoints();
            updateButtonStates();
            updateMap();
        }, 200);
    }

    function initCopy() {
        const copyBtn = $('#copyItineraryBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', copyItineraryToClipboard);
        }
    }

    async function copyItineraryToClipboard() {
        const container = els.itineraryContainer;
        const table = container.querySelector('table');
        if (!table) {
            showToast('❌ 복사할 일정표가 없습니다.');
            return;
        }

        // Clone table to manipulate
        const clone = table.cloneNode(true);
        
        // Inline some styles for Excel
        clone.style.borderCollapse = 'collapse';
        clone.style.width = '100%';
        clone.style.fontFamily = 'sans-serif';

        // Process cells - flatten everything to single lines
        clone.querySelectorAll('th, td').forEach(cell => {
            cell.style.border = '1px solid #dddddd';
            cell.style.padding = '8px';
            cell.style.fontSize = '12px';
            cell.style.whiteSpace = 'nowrap';
            
            // Replace <br> with space
            cell.querySelectorAll('br').forEach(br => {
                br.replaceWith(document.createTextNode(' '));
            });

            // Handle inputs/textareas - replace with their values
            cell.querySelectorAll('input, textarea').forEach(input => {
                const span = document.createElement('span');
                if (input.classList.contains('input-contact')) {
                    span.textContent = '담당자: ' + input.value;
                } else if (input.classList.contains('input-stop-name')) {
                    span.textContent = input.value;
                } else {
                    span.textContent = input.value;
                }
                input.parentNode.replaceChild(span, input);
            });

            // Remove purely decorative or interactive elements
            cell.querySelectorAll('button, .marker-line, .marker-dot').forEach(el => el.remove());
            
            // Clean up break-input-wrapper
            cell.querySelectorAll('.break-input-wrapper').forEach(w => {
                const val = parseInt(w.querySelector('input')?.value) || 0;
                const text = val > 0 ? ` (추가 정지: ${val}분)` : '';
                w.textContent = text;
            });

            // Flatten all divs into inline spans with space separator
            cell.querySelectorAll('div').forEach(div => {
                const span = document.createElement('span');
                span.textContent = div.textContent.trim();
                div.replaceWith(span);
            });
        });

        // Generate cleaned HTML string
        const html = clone.outerHTML;
        
        // Generate plain text version - each cell on single line
        let plainText = "";
        clone.querySelectorAll('tr').forEach(tr => {
            const cells = Array.from(tr.querySelectorAll('th, td')).map(c => {
                return c.textContent.replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
            });
            plainText += cells.join("\t") + "\n";
        });

        try {
            const blobHtml = new Blob([html], { type: 'text/html' });
            const blobText = new Blob([plainText], { type: 'text/plain' });
            const data = [new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })];
            
            await navigator.clipboard.write(data);
            showToast('📋 일정표가 클립보드에 복사되었습니다! (엑셀에 붙여넣기 가능)');
            
            // Visual feedback on button
            const btn = $('#copyItineraryBtn');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '✅ 복사됨';
            btn.classList.add('btn-success');
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.classList.remove('btn-success');
            }, 2000);
            
        } catch (err) {
            console.error('Copy failed', err);
            // Fallback for some browsers
            try {
                await navigator.clipboard.writeText(plainText);
                showToast('📋 텍스트 레이아웃으로 복사되었습니다.');
            } catch (e) {
                showToast('❌ 복사 실패: 브라우저 권한을 확인해주세요.');
            }
        }
    }

    function renumberWaypoints() {
        const routeList = els.routeList || $('#routeList');
        const items = routeList.querySelectorAll('.route-item');
        
        items.forEach((item, i) => {
            const isFirst = i === 0;
            const isLast = i === items.length - 1;
            const label = item.querySelector('.waypoint-header label');
            const dot = item.querySelector('.marker-dot');
            
            // Update Labels
            if (isFirst) {
                if (label) label.textContent = '출발지';
                if (dot) {
                    dot.className = 'marker-dot departure-dot';
                    const lines = item.querySelectorAll('.marker-line');
                    lines.forEach(l => l.style.display = 'block');
                    if (item.querySelector('.marker-line-top')) item.querySelector('.marker-line-top').style.display = 'none';
                }
            } else if (isLast) {
                if (label) label.textContent = '도착지';
                if (dot) {
                    dot.className = 'marker-dot arrival-dot';
                    const lines = item.querySelectorAll('.marker-line');
                    lines.forEach(l => l.style.display = 'none');
                    if (item.querySelector('.marker-line-top')) item.querySelector('.marker-line-top').style.display = 'block';
                }
            } else {
                if (label) label.textContent = `경유지 ${i}`;
                if (dot) {
                    dot.className = 'marker-dot waypoint-dot';
                    const lines = item.querySelectorAll('.marker-line');
                    lines.forEach(l => l.style.display = 'block');
                }
            }
        });
        
        updateStateFromDOM();
    }

    function initDragAndDrop() {
        const routeList = $('#routeList');
        let draggedEl = null;

        routeList.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.route-item');
            if (!item) return;
            draggedEl = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        routeList.addEventListener('dragover', (e) => {
            e.preventDefault();
            const item = e.target.closest('.route-item');
            if (!item || item === draggedEl) return;
            item.classList.add('drag-over');
        });

        routeList.addEventListener('dragleave', (e) => {
            const item = e.target.closest('.route-item');
            if (item) item.classList.remove('drag-over');
        });

        routeList.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetItem = e.target.closest('.route-item');
            if (!targetItem || targetItem === draggedEl) return;

            targetItem.classList.remove('drag-over');
            
            // Determine position
            const rect = targetItem.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            
            if (e.clientY < midY) {
                targetItem.parentNode.insertBefore(draggedEl, targetItem);
            } else {
                targetItem.parentNode.insertBefore(draggedEl, targetItem.nextSibling);
            }
            
            renumberWaypoints();
            updateMap();
            // Automatically recalculate if we have results
            if (state.lastSegments.length > 0) {
                calculateRoute();
            }
        });

        routeList.addEventListener('dragend', () => {
            if (draggedEl) draggedEl.classList.remove('dragging');
            $$('.route-item').forEach(el => el.classList.remove('drag-over'));
            draggedEl = null;
        });
    }

    function updateStateFromDOM() {
        const routeList = $('#routeList');
        const items = routeList.querySelectorAll('.route-item');
        const newWaypoints = [];
        
        items.forEach((item, i) => {
            // Find data in state based on this DOM element
            // We can check if it's the old departureItem, arrivalItem, or a waypoint-item
            const wpId = item.dataset.waypointId;
            
            let data = null;
            if (item.id === 'departureItem') {
                data = state.departure;
            } else if (item.id === 'arrivalItem') {
                data = state.arrival;
            } else {
                data = state.waypoints.find(wp => wp.id === wpId);
            }

            if (!data) return;

            if (i === 0) {
                state.departure = data;
            } else if (i === items.length - 1) {
                state.arrival = data;
            } else {
                newWaypoints.push(data);
            }
        });
        
        state.waypoints = newWaypoints;
    }

    // ===== Button States =====
    function updateButtonStates() {
        const hasDeparture = state.departure !== null;
        const hasArrival = state.arrival !== null;
        els.calcRouteBtn.disabled = !(hasDeparture && hasArrival);
        els.optimizeBtn.disabled = !(hasDeparture && hasArrival && state.waypoints.length >= 2);
    }

    // updateMemos() removed as Visit Details panel is replaced by Itinerary

    // ===== Route Calculation =====
    async function calculateRoute() {
        const points = getAllPoints();
        if (points.length < 2) {
            showToast('⚠️ 출발지와 도착지를 모두 입력해주세요.');
            return;
        }

        showToast('🔄 카카오 길찾기 API를 호출하고 있습니다...');

        try {
            const start = `${points[0].lng},${points[0].lat}`;
            const goal = `${points[points.length - 1].lng},${points[points.length - 1].lat}`;
            let waypointsParam = '';

            if (points.length > 2) {
                const wps = points.slice(1, points.length - 1);
                waypointsParam = wps.map(p => `${p.lng},${p.lat}`).join('|');
            }

            let url = `http://127.0.0.1:5000/api/directions?start=${start}&goal=${goal}`;
            if (waypointsParam) {
                url += `&waypoints=${waypointsParam}`;
            }

            const response = await fetch(url, {
                headers: {
                    'X-NCP-APIGW-API-KEY': state.apiSecret
                }
            });

            const data = await response.json();

            if (!response.ok || (data.routes && data.routes[0].result_code === 104)) {
                console.error("API Error:", data);
                throw new Error(data.msg || '카카오 API 호출 실패');
            }

            const route = data.routes[0];
            const totalDistance = route.summary.distance / 1000; // m -> km
            const totalTime = Math.round(route.summary.duration / 60); // sec -> min

            // Extract path from all sections and roads
            const fullPath = [];
            route.sections.forEach(section => {
                section.roads.forEach(road => {
                    for (let i = 0; i < road.vertexes.length; i += 2) {
                        fullPath.push({
                            x: road.vertexes[i],
                            y: road.vertexes[i + 1]
                        });
                    }
                });
            });

            // Draw real polyline and map markers
            drawRealRouteOnMap(fullPath);

            // Generate segments breakdown from sections
            const startTimeStr = els.departureTimeInput.value;
            let [h, m] = startTimeStr.split(':').map(Number);
            let currentTime = Math.round((h * 60 + m) / 10) * 10;

            const waypointsEls = els.waypointsContainer.querySelectorAll('.waypoint-item');
            const stayDurations = Array.from(waypointsEls).map(el => 
                parseInt(el.querySelector('.stay-duration-input').value) || 0
            );

            const formatTime = (totalMin) => {
                const hh = Math.floor((totalMin % 1440) / 60);
                const mm = totalMin % 60;
                return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
            };

            const segments = route.sections.map((section, i) => {
                // Extract Major Roads Sequence (Optimized)
                const roadSequence = [];
                section.roads.forEach(r => {
                    const name = r.name;
                    if (!name || name.trim() === '') return;
                    const processedName = name.includes('고속도로') ? name : '국도';
                    if (roadSequence.length === 0 || roadSequence[roadSequence.length - 1].name !== processedName) {
                        roadSequence.push({
                            name: processedName,
                            type: processedName === '국도' ? 'local' : 'express'
                        });
                    }
                });

                // Extract Key Nodes (IC, JC, TG)
                const keyNodes = section.guides
                    .filter(g => g.name && (g.name.includes('IC') || g.name.includes('JC') || g.name.includes('TG') || g.name.includes('톨게이트')))
                    .map(g => g.name);
                const uniqueNodes = [...new Set(keyNodes)].slice(0, 4); // Limit to top 4 key points

                const segmentId = `${points[i].name}-${points[i+1].name}`;
                const breakMin = state.segmentBreaks[segmentId] || 0;
                
                const durMin = Math.round(section.duration / 60) + breakMin;
                const roundedDur = Math.round(durMin / 10) * 10;

                const depTime = `${String(Math.floor((currentTime % 1440) / 60)).padStart(2, '0')}:${String(currentTime % 60).padStart(2, '0')}`;
                const arrTime = `${String(Math.floor(((currentTime + roundedDur) % 1440) / 60)).padStart(2, '0')}:${String((currentTime + roundedDur) % 60).padStart(2, '0')}`;

                const segment = {
                    id: segmentId,
                    from: points[i].name,
                    to: points[i+1].name,
                    distance: section.distance / 1000,
                    time: durMin, // Raw for display
                    breakTime: breakMin,
                    roundedTime: roundedDur, // For calculation
                    depTime: depTime,
                    arrTime: arrTime,
                    majorRoads: roadSequence,
                    keyNodes: uniqueNodes
                };

                // Update currentTime for next segment
                const stayMin = i < stayDurations.length ? stayDurations[i] : 0;
                const roundedStay = Math.round(stayMin / 10) * 10;
                currentTime += roundedDur + roundedStay;
                
                return segment;
            });

            displayResults(segments, totalDistance, totalTime);
            state.lastSegments = segments;
            // Removed: updateMemos()

        } catch (error) {
            console.error('Route calculation error:', error);
            let errMsg = error.message;
            if (error instanceof TypeError && (errMsg.includes('fetch') || errMsg.includes('NetworkError'))) {
                errMsg = '로컬 서버(server.py)가 실행되지 않았거나 연결할 수 없습니다. 실제 도로 기반 경로를 보려면 터미널에서 python server.py를 실행해주세요.';
            }
            showToast(`⚠️ ${errMsg} (지점 간 직선 경로를 표시합니다)`);
            fallbackCalculateRoute(points);
        }
    }

    function fallbackCalculateRoute(points) {
        const segments = [];
        let totalDistance = 0;
        let totalTime = 0;

        const waypointsEls = els.waypointsContainer.querySelectorAll('.waypoint-item');
        const stayDurations = Array.from(waypointsEls).map(el => 
            parseInt(el.querySelector('.stay-duration-input').value) || 0
        );

        let [depH, depM] = els.departureTimeInput.value.split(':').map(Number);
        let currentTime = Math.round((depH * 60 + depM) / 10) * 10;

        for (let i = 0; i < points.length - 1; i++) {
            const from = points[i];
            const to = points[i + 1];
            const segmentId = `${from.name}-${to.name}`;
            const breakMin = state.segmentBreaks[segmentId] || 0;

            const dist = haversineDistance(from.lat, from.lng, to.lat, to.lng);
            const durMin = Math.round(dist / 50 * 60) + breakMin;
            const roundedDur = Math.round(durMin / 10) * 10;

            const depTime = `${String(Math.floor((currentTime % 1440) / 60)).padStart(2, '0')}:${String(currentTime % 60).padStart(2, '0')}`;
            const arrTime = `${String(Math.floor(((currentTime + roundedDur) % 1440) / 60)).padStart(2, '0')}:${String((currentTime + roundedDur) % 60).padStart(2, '0')}`;

            segments.push({
                id: segmentId,
                from: from.name,
                to: to.name,
                distance: dist,
                time: durMin,
                breakTime: breakMin,
                roundedTime: roundedDur,
                depTime: depTime,
                arrTime: arrTime,
                majorRoads: [],
                keyNodes: []
            });
            totalDistance += dist;
            totalTime += durMin;

            const stayMin = i < stayDurations.length ? stayDurations[i] : 0;
            const roundedStay = Math.round(stayMin / 10) * 10;
            currentTime += roundedDur + roundedStay;
        }

        displayResults(segments, totalDistance, totalTime);
        updateMap();
    }

    function drawRealRouteOnMap(pathData) {
        clearMapObjects();
        const points = getAllPoints();
        const bounds = new kakao.maps.LatLngBounds();

        // Draw Markers
        points.forEach((p, i) => {
            const pos = new kakao.maps.LatLng(p.lat, p.lng);
            bounds.extend(pos);
            const isFirst = i === 0;
            const isLast = i === points.length - 1;

            const content = `
                <div style="
                    background:${isFirst ? '#2ecc71' : isLast ? '#e74c3c' : '#3498db'};
                    color:#fff; font-weight:700; font-size:12px;
                    width:28px; height:28px; border-radius:50%;
                    display:flex; align-items:center; justify-content:center;
                    box-shadow:0 2px 8px rgba(0,0,0,0.3);
                    border:2px solid #fff;">${i + 1}</div>`;

            const overlay = new kakao.maps.CustomOverlay({
                position: pos,
                content: content,
                map: state.map,
                yAnchor: 0.5
            });
            state.markers.push(overlay);
        });

        // Draw real polyline
        const linePath = [];
        pathData.forEach(pos => {
            const latlng = new kakao.maps.LatLng(pos.y, pos.x);
            linePath.push(latlng);
            bounds.extend(latlng);
        });

        const polyline = new kakao.maps.Polyline({
            map: state.map,
            path: linePath,
            strokeColor: '#3498db',
            strokeWeight: 6,
            strokeOpacity: 0.8,
            strokeStyle: 'solid'
        });
        state.polylines.push(polyline);
        state.map.setBounds(bounds);
    }

    function haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function displayResults(segments, totalDistance, totalTime) {
        if (!els.itineraryContainer) return;

        const allPoints = getAllPoints();
        const waypointsEls = els.waypointsContainer.querySelectorAll('.waypoint-item');
        const stayDurations = Array.from(waypointsEls).map(el => 
            parseInt(el.querySelector('.stay-duration-input').value) || 0
        );

        // Get current date for the title
        const now = new Date();
        const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;
        const dayStr = ['일','월','화','수','목','금','토'][now.getDay()];

        let tableHtml = `
            <div class="itinerary-summary" style="padding:1rem; background:var(--bg-input); border-radius:12px; margin-bottom:1rem; font-size:0.85rem;">
                <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">
                    <span style="color:var(--text-muted)">총 거리:</span>
                    <span style="font-weight:700; color:var(--accent-green)">${totalDistance.toFixed(1)}km</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span style="color:var(--text-muted)">총 소요시간:</span>
                    <span style="font-weight:700; color:var(--accent-blue)">${Math.floor(totalTime / 60)}시간 ${totalTime % 60}분</span>
                </div>
            </div>
            <table class="itinerary-table">
                <thead>
                    <tr>
                        <th style="width: 75px;">시간</th>
                        <th>일정</th>
                        <th style="width: 70px; text-align:center;">소요</th>
                        <th>상세정보</th>
                    </tr>
                </thead>
                <tbody>
        `;

        segments.forEach((seg, i) => {
            // 1. Travel Row
            tableHtml += `
                <tr class="row-travel">
                    <td class="col-time">${seg.depTime} ~<br>${seg.arrTime}</td>
                    <td class="col-schedule"><span class="travel-stop-label" data-point-id="${allPoints[i] ? (allPoints[i].id || allPoints[i].lat+'-'+allPoints[i].lng) : ''}">${state.customNames[allPoints[i] ? (allPoints[i].id || allPoints[i].lat+'-'+allPoints[i].lng) : ''] || seg.from}</span> ~<br><span class="travel-stop-label" data-point-id="${allPoints[i+1] ? (allPoints[i+1].id || allPoints[i+1].lat+'-'+allPoints[i+1].lng) : ''}">${state.customNames[allPoints[i+1] ? (allPoints[i+1].id || allPoints[i+1].lat+'-'+allPoints[i+1].lng) : ''] || seg.to}</span></td>
                    <td class="col-duration">
                        <div class="dur-val">${seg.time} min</div>
                        <div class="dist-val">(약 ${Math.ceil(seg.distance / 10) * 10}km)</div>

                    </td>
                    <td class="col-remarks">
                        <div class="travel-remark-group">
                            <input type="text" class="input-travel-remark" 
                                data-segment-id="${seg.id}" 
                                value="${state.segmentRemarks[seg.id] || ''}" 
                                placeholder="이동 시 비고 (예: 중식 포함)">
                            <div class="break-input-wrapper">
                                <span>추가 정지: </span>
                                <input type="number" class="input-travel-break" 
                                    data-segment-id="${seg.id}" 
                                    value="${state.segmentBreaks[seg.id] || 0}" 
                                    min="0" step="10">
                                <span>분</span>
                            </div>
                        </div>

                    </td>
                </tr>
            `;

            // 2. Stay Row
            if (i < segments.length) {
                const point = allPoints[i + 1];
                const isLast = (i === segments.length - 1);
                const id = point.id || `${point.lat}-${point.lng}`;
                const stayMin = i < stayDurations.length ? stayDurations[i] : 0;
                const roundedStay = Math.round(stayMin / 10) * 10;
                
                const startTime = seg.arrTime;
                let [h, m] = startTime.split(':').map(Number);
                let endMin = h * 60 + m + roundedStay;
                const endTime = `${String(Math.floor((endMin % 1440) / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

                tableHtml += `
                    <tr class="row-stay" data-point-id="${id}">
                        <td class="col-time">${startTime} ~<br>${endTime}</td>
                        <td class="col-schedule">
                            <input type="text" class="input-stop-name" 
                                data-point-id="${id}"
                                value="${state.customNames[id] || point.name}" 
                                style="font-weight:700; background:transparent; border:1px solid transparent; color:var(--text-primary); width:100%; padding:2px 4px; border-radius:4px; font-size:inherit; transition:border-color 0.2s;"
                                onfocus="this.style.borderColor='var(--accent-green)'"
                                onblur="this.style.borderColor='transparent'">
                        </td>
                        <td class="col-duration">${stayMin} min</td>
                        <td class="col-remarks">
                            ${isLast ? '' : `
                                <div class="remark-item">
                                    <div class="remark-addr">📍 ${point.address || ''}</div>
                                    <div class="remark-contact" style="display:flex; align-items:center; margin-top:4px; border-top:1px dashed var(--border-subtle); padding-top:4px;">
                                        <span style="color:var(--text-muted); font-size:0.75rem; margin-right:6px; white-space:nowrap;">👤 담당:</span>
                                        <input type="text" class="input-contact" 
                                            data-point-id="${id}" 
                                            value="${(state.contacts[id] || '').replace('담당자: ', '').replace('담당자:', '')}" 
                                            placeholder="성명/직함/연락처"
                                            style="border:none; background:transparent; color:var(--accent-blue); font-size:0.8rem; width:100%; outline:none; font-weight:500;">
                                    </div>
                                </div>
                            `}
                        </td>
                    </tr>
                `;
            }
        });

        tableHtml += `</tbody></table>`;
        els.itineraryContainer.innerHTML = tableHtml;

        // Setup contact sync
        els.itineraryContainer.querySelectorAll('.input-contact').forEach(input => {
            input.addEventListener('input', (e) => {
                const id = e.target.dataset.pointId;
                state.contacts[id] = e.target.value;
            });
        });

        // Setup travel remark sync
        els.itineraryContainer.querySelectorAll('.input-travel-remark').forEach(input => {
            input.addEventListener('input', (e) => {
                const id = e.target.dataset.segmentId;
                state.segmentRemarks[id] = e.target.value;
            });
        });

        // Setup travel break sync
        els.itineraryContainer.querySelectorAll('.input-travel-break').forEach(input => {
            input.addEventListener('change', (e) => {
                const id = e.target.dataset.segmentId;
                state.segmentBreaks[id] = parseInt(e.target.value) || 0;
                // Re-calculate route since time changed
                calculateRoute(); 
            });
        });

        // Setup stop name editing
        els.itineraryContainer.querySelectorAll('.input-stop-name').forEach(input => {
            input.addEventListener('input', (e) => {
                const id = e.target.dataset.pointId;
                state.customNames[id] = e.target.value;
                els.itineraryContainer.querySelectorAll('.travel-stop-label').forEach(label => {
                    if (label.dataset.pointId === id) {
                        label.textContent = e.target.value;
                    }
                });
            });
        });

        showToast('✅ 비즈니스 일정표가 생성되었습니다! (경유지 이름 클릭 시 수정 가능)');
    }

    // Removed: syncMemoToTable() - No longer needed without memo inputs

    function formatTime(minutes) {
        if (minutes < 60) return `${minutes}분`;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
    }

    // ===== Optimize Route =====
    function optimizeRoute() {
        const validWaypoints = state.waypoints.filter(wp => wp.lat && wp.lng);
        if (validWaypoints.length < 2) {
            showToast('⚠️ 최적화하려면 경유지가 2개 이상 필요합니다.');
            return;
        }

        showToast('🔄 경유지 순서를 최적화하고 있습니다...');

        // Simple nearest-neighbor optimization
        const optimized = nearestNeighborOptimize(state.departure, validWaypoints, state.arrival);

        // Reorder waypoints in state
        const reorderedIds = optimized.map(wp => wp.id);
        state.waypoints = reorderedIds.map(id => state.waypoints.find(wp => wp.id === id))
            .filter(Boolean)
            .concat(state.waypoints.filter(wp => !wp.lat || !wp.lng));

        // Reorder DOM elements
        const container = els.waypointsContainer;
        reorderedIds.forEach(id => {
            const el = container.querySelector(`[data-waypoint-id="${id}"]`);
            if (el) container.appendChild(el);
        });
        renumberWaypoints();

        // Recalculate
        setTimeout(() => calculateRoute(), 300);
        showToast('✅ 경유지 순서가 최적화되었습니다!');
    }

    function nearestNeighborOptimize(start, waypoints, end) {
        if (waypoints.length === 0) return [];

        let remaining = [...waypoints];
        let result = [];
        let current = start;

        // 1. Initial Nearest Neighbor
        while (remaining.length > 0) {
            let nearestIdx = 0;
            let nearestDist = Infinity;
            remaining.forEach((wp, i) => {
                const d = haversineDistance(current.lat, current.lng, wp.lat, wp.lng);
                if (d < nearestDist) {
                    nearestDist = d;
                    nearestIdx = i;
                }
            });
            current = remaining.splice(nearestIdx, 1)[0];
            result.push(current);
        }

        // 2. 2-opt Improvement (Local Search)
        // Only if we have enough waypoints to swap
        if (result.length >= 2) {
            result = twoOptImprove(start, result, end);
        }

        return result;
    }

    function twoOptImprove(start, waypoints, end) {
        let bestPath = [...waypoints];
        let improved = true;

        const getFullDistance = (path) => {
            let dist = 0;
            let p = [start, ...path, end];
            for (let i = 0; i < p.length - 1; i++) {
                dist += haversineDistance(p[i].lat, p[i].lng, p[i + 1].lat, p[i + 1].lng);
            }
            return dist;
        };

        let bestDist = getFullDistance(bestPath);

        // Limit iterations to prevent hanging
        let iterations = 0;
        while (improved && iterations < 50) {
            improved = false;
            iterations++;
            for (let i = 0; i < bestPath.length - 1; i++) {
                for (let j = i + 1; j < bestPath.length; j++) {
                    // Reverse the segment between i and j
                    const newPath = [...bestPath];
                    const segment = newPath.slice(i, j + 1).reverse();
                    newPath.splice(i, j - i + 1, ...segment);

                    const newDist = getFullDistance(newPath);
                    if (newDist < bestDist) {
                        bestDist = newDist;
                        bestPath = newPath;
                        improved = true;
                    }
                }
            }
        }
        return bestPath;
    }

    // ===== Reset =====
    function resetAll() {
        state.departure = null;
        state.arrival = null;
        state.waypoints = [];
        state.waypointCounter = 0;

        els.departureInput.value = '';
        els.departureInput.classList.remove('has-value');
        els.departureInfo.textContent = '';
        els.departureInfo.classList.remove('has-info');

        els.arrivalInput.value = '';
        els.arrivalInput.classList.remove('has-value');
        els.arrivalInfo.textContent = '';
        els.arrivalInfo.classList.remove('has-info');

        els.waypointsContainer.innerHTML = '';
        els.itineraryContainer.innerHTML = `
            <div class="itinerary-empty">
                <div class="itinerary-empty-icon">📊</div>
                <p>경로를 계산하시면<br>상세 일정표가 여기에 표시됩니다.</p>
            </div>
        `;

        updateButtonStates();
        clearMapObjects();

        if (state.map) {
            state.map.setCenter(new kakao.maps.LatLng(37.3595704, 127.105399));
            state.map.setLevel(5);
        }

        showToast('🔄 모든 입력이 초기화되었습니다.');
    }

    // ===== Toast =====
    let toastTimer;
    function showToast(msg) {
        clearTimeout(toastTimer);
        els.toast.textContent = msg;
        els.toast.classList.add('show');
        toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3000);
    }

    // ===== Save/Load Schedule =====
    function initSaveSchedule() {
        if (els.saveScheduleBtn) {
            els.saveScheduleBtn.addEventListener('click', showSaveModal);
        }
        if (els.confirmSaveBtn) {
            els.confirmSaveBtn.addEventListener('click', saveSchedule);
        }
        if (els.scheduleNameInput) {
            els.scheduleNameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') saveSchedule();
            });
        }
    }

    function showSaveModal() {
        // Check if there's something to save
        if (!state.departure && !state.arrival) {
            showToast('⚠️ 저장할 일정이 없습니다. 경로를 먼저 설정해주세요.');
            return;
        }
        els.saveScheduleModal.classList.remove('hidden');
        // Auto-suggest name
        const now = new Date();
        const prefix = `${now.getMonth() + 1}/${now.getDate()}`;
        const route = state.departure ? state.departure.name : '';
        els.scheduleNameInput.value = `${prefix} ${route} 방문`;
        els.scheduleNameInput.select();
        setTimeout(() => els.scheduleNameInput.focus(), 100);
    }

    function saveSchedule() {
        const name = els.scheduleNameInput.value.trim();
        if (!name) {
            showToast('⚠️ 일정 이름을 입력해주세요.');
            return;
        }

        // Gather stayDurations from DOM
        const waypointsEls = els.waypointsContainer.querySelectorAll('.waypoint-item');
        const stayDurations = Array.from(waypointsEls).map(el => 
            parseInt(el.querySelector('.stay-duration-input').value) || 0
        );

        const scheduleData = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            name: name,
            savedAt: new Date().toISOString(),
            departure: state.departure,
            arrival: state.arrival,
            waypoints: state.waypoints.map(wp => ({...wp})),
            departureTime: els.departureTimeInput.value,
            contacts: {...state.contacts},
            customNames: {...state.customNames},
            segmentBreaks: {...state.segmentBreaks},
            segmentRemarks: {...state.segmentRemarks},
            lastSegments: state.lastSegments.map(s => ({...s})),
            stayDurations: stayDurations,
            itineraryHtml: els.itineraryContainer.innerHTML
        };

        const saved = JSON.parse(localStorage.getItem('visit_schedules') || '[]');
        saved.unshift(scheduleData);
        localStorage.setItem('visit_schedules', JSON.stringify(saved));

        els.saveScheduleModal.classList.add('hidden');
        renderSavedSchedules();
        showToast(`✅ "${name}" 일정이 저장되었습니다!`);
    }

    function loadSchedule(id) {
        const saved = JSON.parse(localStorage.getItem('visit_schedules') || '[]');
        const schedule = saved.find(s => s.id === id);
        if (!schedule) {
            showToast('❌ 저장된 일정을 찾을 수 없습니다.');
            return;
        }

        // 1. Reset current state
        resetAll();

        // 2. Restore state values
        state.departure = schedule.departure;
        state.arrival = schedule.arrival;
        state.contacts = schedule.contacts || {};
        state.customNames = schedule.customNames || {};
        state.segmentBreaks = schedule.segmentBreaks || {};
        state.segmentRemarks = schedule.segmentRemarks || {};
        state.lastSegments = schedule.lastSegments || [];

        // 3. Restore departure time
        if (schedule.departureTime) {
            els.departureTimeInput.value = schedule.departureTime;
        }

        // 4. Restore departure input
        if (state.departure) {
            els.departureInput.value = state.departure.name;
            els.departureInput.classList.add('has-value');
            els.departureInfo.textContent = state.departure.address;
            els.departureInfo.classList.add('has-info');
        }

        // 5. Restore arrival input
        if (state.arrival) {
            els.arrivalInput.value = state.arrival.name;
            els.arrivalInput.classList.add('has-value');
            els.arrivalInfo.textContent = state.arrival.address;
            els.arrivalInfo.classList.add('has-info');
        }

        // 6. Restore waypoints
        state.waypoints = [];
        state.waypointCounter = 0;
        if (schedule.waypoints && schedule.waypoints.length > 0) {
            schedule.waypoints.forEach((wp, i) => {
                state.waypointCounter++;
                const id = 'wp_' + state.waypointCounter;
                const wpData = { id, name: wp.name, address: wp.address, lat: wp.lat, lng: wp.lng };
                state.waypoints.push(wpData);

                const stayVal = schedule.stayDurations && schedule.stayDurations[i] !== undefined 
                    ? schedule.stayDurations[i] : 60;

                const wpEl = document.createElement('div');
                wpEl.className = 'route-item waypoint-item draggable';
                wpEl.dataset.waypointId = id;
                wpEl.setAttribute('draggable', 'true');
                wpEl.innerHTML = `
                    <div class="drag-handle">⋮⋮</div>
                    <div class="route-marker">
                        <div class="marker-line marker-line-top"></div>
                        <div class="marker-dot waypoint-dot"></div>
                        <div class="marker-line"></div>
                    </div>
                    <div class="waypoint-input-group">
                        <div class="waypoint-header">
                            <label>경유지 ${i + 1}</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <div class="time-input-wrapper">
                                    <span>체류:</span>
                                    <input type="number" class="stay-duration-input" value="${stayVal}" min="0" step="10">
                                    <span>분</span>
                                </div>
                                <button class="btn-remove-waypoint" data-id="${id}" title="삭제">✕</button>
                            </div>
                        </div>
                        <div class="search-wrapper">
                            <input type="text" class="location-input has-value" value="${wp.name}" placeholder="경유 장소를 검색하세요" autocomplete="off">
                            <div class="search-dropdown"></div>
                        </div>
                        <div class="location-info has-info">${wp.address}</div>
                    </div>
                `;

                els.waypointsContainer.appendChild(wpEl);

                // Setup search for this waypoint
                const wpInput = wpEl.querySelector('.location-input');
                const wpDropdown = wpEl.querySelector('.search-dropdown');
                const wpInfo = wpEl.querySelector('.location-info');

                setupSearch(wpInput, wpDropdown, (place) => {
                    wpData.name = place.name;
                    wpData.address = place.address;
                    wpData.lat = place.lat;
                    wpData.lng = place.lng;
                    if (wpInput._setSearchValue) {
                        wpInput._setSearchValue(place.name);
                    } else {
                        wpInput.value = place.name;
                    }
                    wpInput.classList.add('has-value');
                    wpInfo.textContent = place.address;
                    wpInfo.classList.add('has-info');
                    updateButtonStates();
                    updateMap();
                });

                // Remove button
                wpEl.querySelector('.btn-remove-waypoint').addEventListener('click', () => {
                    removeWaypoint(id, wpEl);
                });
            });
        }

        // 7. Restore itinerary HTML
        if (schedule.itineraryHtml) {
            els.itineraryContainer.innerHTML = schedule.itineraryHtml;
            
            // Re-bind event listeners for itinerary inputs
            els.itineraryContainer.querySelectorAll('.input-contact').forEach(input => {
                input.addEventListener('input', (e) => {
                    const pointId = e.target.dataset.pointId;
                    state.contacts[pointId] = e.target.value;
                });
            });
            els.itineraryContainer.querySelectorAll('.input-travel-remark').forEach(input => {
                input.addEventListener('input', (e) => {
                    const segId = e.target.dataset.segmentId;
                    state.segmentRemarks[segId] = e.target.value;
                });
            });
            els.itineraryContainer.querySelectorAll('.input-travel-break').forEach(input => {
                input.addEventListener('change', (e) => {
                    const segId = e.target.dataset.segmentId;
                    state.segmentBreaks[segId] = parseInt(e.target.value) || 0;
                    calculateRoute();
                });
            });
            els.itineraryContainer.querySelectorAll('.input-stop-name').forEach(input => {
                input.addEventListener('input', (e) => {
                    const pointId = e.target.dataset.pointId;
                    state.customNames[pointId] = e.target.value;
                    els.itineraryContainer.querySelectorAll('.travel-stop-label').forEach(label => {
                        if (label.dataset.pointId === pointId) {
                            label.textContent = e.target.value;
                        }
                    });
                });
            });
        }

        // 8. Update button states and map
        updateButtonStates();
        updateMap();

        showToast(`📂 "${schedule.name}" 일정을 불러왔습니다!`);
    }

    function deleteSchedule(id, event) {
        event.stopPropagation();
        const saved = JSON.parse(localStorage.getItem('visit_schedules') || '[]');
        const idx = saved.findIndex(s => s.id === id);
        if (idx === -1) return;
        const name = saved[idx].name;
        saved.splice(idx, 1);
        localStorage.setItem('visit_schedules', JSON.stringify(saved));
        renderSavedSchedules();
        showToast(`🗑️ "${name}" 일정이 삭제되었습니다.`);
    }

    // Expose for inline onclick
    window._loadSchedule = loadSchedule;
    window._deleteSchedule = deleteSchedule;

    function renderSavedSchedules() {
        const list = els.savedSchedulesList;
        if (!list) return;
        const saved = JSON.parse(localStorage.getItem('visit_schedules') || '[]');

        if (saved.length === 0) {
            list.innerHTML = `
                <div class="saved-empty">
                    <div class="saved-empty-icon">📭</div>
                    <p>저장된 일정이 없습니다.<br>경로 계산 후 💾 저장을 눌러보세요.</p>
                </div>
            `;
            return;
        }

        list.innerHTML = saved.map(s => {
            const date = new Date(s.savedAt);
            const dateStr = `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
            const dep = s.departure ? s.departure.name : '?';
            const arr = s.arrival ? s.arrival.name : '?';
            const wpCount = s.waypoints ? s.waypoints.length : 0;
            return `
                <div class="saved-schedule-card" onclick="window._loadSchedule('${s.id}')">
                    <div class="schedule-name">${s.name}</div>
                    <div class="schedule-route">${dep} → ${wpCount > 0 ? wpCount + '곳 경유 → ' : ''}${arr}</div>
                    <div class="schedule-meta">
                        <span>📅 ${dateStr}</span>
                        <span>🕐 출발 ${s.departureTime || '07:00'}</span>
                    </div>
                    <button class="btn-delete-schedule" onclick="window._deleteSchedule('${s.id}', event)" title="삭제">✕</button>
                </div>
            `;
        }).join('');
    }

    // ===== Start =====
    document.addEventListener('DOMContentLoaded', init);
})();
