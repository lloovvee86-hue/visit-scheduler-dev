# Python 경량화 이미지를 사용합니다.
FROM python:3.12-slim

# 작업 디렉토리를 설정합니다.
WORKDIR /app

# 필요한 패키지 리스트를 복사하고 설치합니다.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드를 복사합니다.
COPY . .

# Flask 서버 포트를 외부로 노출합니다.
EXPOSE 5000

# 서버를 실행합니다. (Gunicorn 권장되나 로컬 테스트성 Dev 서버이므로 python server.py로 유지)
CMD ["python", "server.py"]
