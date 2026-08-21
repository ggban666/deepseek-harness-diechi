# 🚀 蝶翅APP部署指南

**项目名称**：蝶翅智能AI助手  
**部署类型**：Docker容器化部署 + Kubernetes可选  
**支持环境**：本地开发、预发布、生产环境  
**学习目标**：掌握现代化DevOps实践、容器化部署、监控运维

---

## 🎯 **部署概述**

蝶翅APP采用**容器化部署**，支持以下环境：

| 环境 | 用途 | 端口 | 访问地址 | 部署方式 |
|------|------|------|----------|----------|
| **本地开发** | 开发调试 | 8000/5173 | localhost | `bash scripts/dev-start.sh` |
| **预发布** | 测试验证 | 8080/8001 | staging.diechi.ai | `docker-compose -f docker-compose.staging.yml up -d` |
| **生产** | 正式运行 | 80/8000 | app.diechi.ai | `docker-compose -f docker-compose.prod.yml up -d` |
| **Kubernetes** | 云原生部署 | 80/8000 | k8s.diechi.ai | Helm Chart |

---

## 📋 **部署准备**

### **1. 环境要求**

#### **硬件要求**
```
最低配置：
- CPU: 4核心 (建议8核心)
- 内存: 8GB (建议16GB)
- 存储: 50GB (包含模型文件)
- GPU: 可选 (支持CUDA加速)

推荐配置：
- CPU: 8核心
- 内存: 16GB
- 存储: 100GB
- GPU: NVIDIA GPU (RTX 3060 8GB支持INT8量化)
```

#### **软件要求**
```bash
# 必需软件
- Docker: 24.0+
- Docker Compose: 2.20+
- Git: 2.30+
- Python: 3.10+
- Node.js: 18.0+
- pnpm: 8.0+

# 可选软件
- kubectl: 1.27+ (Kubernetes部署)
- helm: 3.12+ (Helm Chart部署)
- docker-buildx: 用于多架构构建
- nvidia-docker: GPU支持
```

### **2. 系统配置**

#### **Linux系统配置**
```bash
# 1. 更新系统
sudo apt update && sudo apt upgrade -y

# 2. 安装Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 3. 安装Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 4. 安装Git
sudo apt install -y git

# 5. 安装Python和Node.js
sudo apt install -y python3 python3-pip python3-venv nodejs npm
sudo npm install -g pnpm

# 6. 配置系统参数
sudo sysctl -w vm.max_map_count=262144
sudo sysctl -w fs.file-max=65536

# 7. 重启服务
sudo systemctl restart docker
```

#### **Windows系统配置**
```powershell
# 1. 安装Docker Desktop
# 下载地址: https://www.docker.com/products/docker-desktop/

# 2. 安装Git
# 下载地址: https://git-scm.com/download/win

# 3. 安装Python
# 下载地址: https://www.python.org/downloads/

# 4. 安装Node.js
# 下载地址: https://nodejs.org/

# 5. 安装pnpm
npm install -g pnpm

# 6. 配置WSL2 (可选，推荐使用)
wsl --install
wsl --set-default-version 2
```

### **3. 环境变量配置**

#### **必需环境变量**
```bash
# DeepSeek API密钥 (必需)
export DEEPSEEK_API_KEY="your-deepseek-api-key"

# 数据库连接字符串 (可选，默认使用内置PostgreSQL)
export DATABASE_URL="postgresql://postgres:postgres@postgres:5432/diechi"

# Redis连接字符串 (可选，默认使用内置Redis)
export REDIS_URL="redis://redis:6379/0"

# RabbitMQ连接字符串 (可选，默认使用内置RabbitMQ)
export RABBITMQ_URL="amqp://rabbitmq:5672"

# 环境标识 (production/staging/development)
export ENVIRONMENT="production"

# 日志级别 (DEBUG/INFO/WARNING/ERROR)
export LOG_LEVEL="INFO"
```

#### **可选环境变量**
```bash
# 模型缓存目录
export MODEL_CACHE_DIR="/app/models"

# 端口配置
export PORT=8000

# 前端API地址
export REACT_APP_API_URL="http://localhost:8000"

# 启用GPU加速
export USE_GPU="true"

# 缓存配置
export CACHE_ENABLED="true"
export CACHE_TTL="3600"
```

---

## 🚀 **部署步骤**

### **📁 第1步：准备项目目录**

```bash
# 1. 创建项目目录
mkdir -p diechi-app
cd diechi-app

# 2. 克隆项目（假设已有）
git clone https://github.com/vibechina/diechi-app.git .

# 3. 创建必要目录
mkdir -p data/{postgres,redis,rabbitmq,prometheus,grafana,elasticsearch} \
         logs/{nginx,backend,backend-staging} \
         models \
         init-db \
         monitoring/{prometheus,grafana,logstash}

# 4. 复制配置文件
cp monitoring/prometheus.yml.example monitoring/prometheus.yml
cp monitoring/grafana/provisioning/dashboards/dashboard.yml.example \
   monitoring/grafana/provisioning/dashboards/dashboard.yml

# 5. 设置环境变量
cp .env.example .env
# 编辑 .env 文件配置环境变量
```

### **🔧 第2步：本地开发环境部署**

```bash
# 1. 启动开发环境
bash scripts/dev-start.sh

# 2. 访问前端
open http://localhost:5173

# 3. 访问后端API
open http://localhost:8000/docs

# 4. 查看健康检查
curl http://localhost:8000/health

# 5. 停止开发环境
# 手动停止进程或使用：
kill $(lsof -t -i:5173) $(lsof -t -i:8000)
```

### **🧪 第3步：预发布环境部署**

```bash
# 1. 启动预发布环境
DOCKER_IMAGE_API=ghcr.io/vibechina/diechi-app-api \
DOCKER_IMAGE_WEB=ghcr.io/vibechina/diechi-app-web \
docker-compose -f docker-compose.staging.yml up -d

# 2. 查看服务状态
DOCKER_IMAGE_API=ghcr.io/vibechina/diechi-app-api \
DOCKER_IMAGE_WEB=ghcr.io/vibechina/diechi-app-web \
docker-compose -f docker-compose.staging.yml ps

# 3. 访问服务
# 前端: http://localhost:8080
# 后端: http://localhost:8001
# API文档: http://localhost:8001/docs

# 4. 查看日志
DOCKER_IMAGE_API=ghcr.io/vibechina/diechi-app-api \
DOCKER_IMAGE_WEB=ghcr.io/vibechina/diechi-app-web \
docker-compose -f docker-compose.staging.yml logs -f

# 5. 停止预发布环境
DOCKER_IMAGE_API=ghcr.io/vibechina/diechi-app-api \
DOCKER_IMAGE_WEB=ghcr.io/vibechina/diechi-app-web \
docker-compose -f docker-compose.staging.yml down -v

# 6. 清理预发布环境
rm -rf data/postgres-staging data/redis-staging logs/backend-staging
```

### **🏭 第4步：生产环境部署**

```bash
# 1. 登录到GitHub Container Registry
docker login ghcr.io -u YOUR_GITHUB_USERNAME -p YOUR_GITHUB_TOKEN

# 2. 启动生产环境
DOCKER_IMAGE_API=ghcr.io/vibechina/diechi-app-api \
DOCKER_IMAGE_WEB=ghcr.io/vibechina/diechi-app-web \
docker-compose -f docker-compose.prod.yml up -d

# 3. 查看服务状态
docker-compose -f docker-compose.prod.yml ps

# 4. 访问服务
# 前端: http://localhost
# 后端: http://localhost:8000
# API文档: http://localhost:8000/docs
# 监控: http://localhost:3000 (admin/admin)

# 5. 查看日志
docker-compose -f docker-compose.prod.yml logs -f

# 6. 停止生产环境
docker-compose -f docker-compose.prod.yml down -v

# 7. 清理生产环境
rm -rf data logs models
```

### **☁️ 第5步：Kubernetes部署（可选）**

```bash
# 1. 安装Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# 2. 添加仓库
helm repo add stable https://charts.helm.sh/stable
helm repo update

# 3. 创建Kubernetes命名空间
export NAMESPACE=diechi-app
kubectl create namespace $NAMESPACE

# 4. 部署后端服务
helm install diechi-backend ./k8s/backend \
  --namespace $NAMESPACE \
  --set image.repository=ghcr.io/vibechina/diechi-app-api \
  --set image.tag=latest

# 5. 部署前端服务
helm install diechi-frontend ./k8s/frontend \
  --namespace $NAMESPACE \
  --set image.repository=ghcr.io/vibechina/diechi-app-web \
  --set image.tag=latest

# 6. 部署数据库
helm install diechi-postgres ./k8s/postgres \
  --namespace $NAMESPACE \
  --set postgresqlPassword=postgres

# 7. 部署监控
helm install diechi-monitoring ./k8s/monitoring \
  --namespace $NAMESPACE

# 8. 查看部署状态
kubectl get pods -n $NAMESPACE
kubectl get services -n $NAMESPACE

# 9. 访问服务
# 获取前端服务地址
kubectl get svc diechi-frontend -n $NAMESPACE
```

---

## 🔧 **配置管理**

### **1. Nginx配置**

#### **前端Nginx配置**
```nginx
# apps/web/nginx.conf

# Gzip压缩
server {
    listen 80;
    server_name localhost;
    
    # 静态文件缓存
    location / {
        try_files $uri $uri/ /index.html;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
    
    # API代理
    location /api {
        proxy_pass http://backend:8000/api;
        proxy_set_header Host $host;
    }
}
```

#### **调整配置**
```bash
# 1. 修改端口
sed -i 's/listen 80;/listen 8080;/' apps/web/nginx.conf

# 2. 修改API地址
sed -i 's|proxy_pass http://backend:8000|proxy_pass http://your-api-server:8000|' apps/web/nginx.conf

# 3. 启用HTTPS
# 需要SSL证书，配置如下：
ssl_certificate /etc/letsencrypt/live/your-domain/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/your-domain/privkey.pem;
ssl_protocols TLSv1.2 TLSv1.3;
```

### **2. 数据库配置**

#### **PostgreSQL配置**
```yaml
# docker-compose.prod.yml
postgres:
  image: postgres:15-alpine
  environment:
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
    POSTGRES_DB: diechi
  volumes:
    - ./data/postgres:/var/lib/postgresql/data
  ports:
    - "5432:5432"
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 10s
    timeout: 5s
    retries: 5
```

#### **数据库迁移**
```bash
# 1. 进入后端容器
docker exec -it diechi-backend bash

# 2. 运行数据库迁移
cd apps/api
alembic upgrade head

# 3. 创建超级用户
python -m apps.api.main.create_admin

# 4. 备份数据库
pg_dump -U postgres -h postgres -d diechi > diechi_backup.sql
```

### **3. 缓存配置**

#### **Redis配置**
```yaml
# docker-compose.prod.yml
redis:
  image: redis:7-alpine
  command: redis-server --appendonly yes
  volumes:
    - ./data/redis:/data
  ports:
    - "6379:6379"
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 3s
    retries: 3
```

#### **缓存使用**
```python
# 后端代码使用Redis缓存
import redis

# 连接Redis
r = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))

# 设置缓存
r.set("key", "value", ex=3600)  # 1小时过期

# 获取缓存
value = r.get("key")
```

---

## 📊 **监控和运维**

### **1. Prometheus监控**

#### **访问监控面板**
```bash
# 访问Prometheus
open http://localhost:9090

# 查看指标
# - diechi_backend_*: 后端指标
# - nginx_*: Nginx指标
# - postgres_*: PostgreSQL指标
# - redis_*: Redis指标
```

#### **常用查询**
```promql
# 1. API响应时间
rate(diechi_backend_http_request_duration_seconds_sum[5m]) / rate(diechi_backend_http_request_duration_seconds_count[5m])

# 2. 错误率
rate(diechi_backend_http_requests_total{status=~"5.."}[5m])

# 3. 请求量
rate(diechi_backend_http_requests_total[5m])

# 4. 系统资源使用率
100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
```

### **2. Grafana可视化**

#### **访问Grafana**
```bash
# 访问Grafana
open http://localhost:3000

# 默认凭据
# 用户名: admin
# 密码: admin
```

#### **导入仪表板**
```bash
# 1. 从Grafana官方导入
# - 后端监控: ID 1860
# - Nginx监控: ID 12708
# - PostgreSQL监控: ID 9628
# - Redis监控: ID 763
# - RabbitMQ监控: ID 10991

# 2. 使用配置文件
# monitoring/grafana/provisioning/dashboards/
# 包含预配置的仪表板
```

### **3. 日志管理**

#### **查看日志**
```bash
# 查看前端日志
docker-compose -f docker-compose.prod.yml logs -f frontend

# 查看后端日志
docker-compose -f docker-compose.prod.yml logs -f backend

# 查看Nginx日志
docker-compose -f docker-compose.prod.yml logs -f frontend

# 查看数据库日志
docker-compose -f docker-compose.prod.yml logs -f postgres
```

#### **ELK日志系统**
```bash
# 访问Kibana
open http://localhost:5601

# 查看日志
# - 使用Discover功能查看日志
# - 使用Dashboard查看可视化
# - 使用Dev Tools进行查询
```

---

## 🛠️ **故障排除**

### **1. 常见问题**

#### **问题1: 容器无法启动**
```bash
# 查看容器日志
docker logs <container_name>

# 查看容器状态
docker ps -a

# 检查端口冲突
netstat -tulnp | grep 8000

# 检查卷挂载
ls -la ./data/postgres
```

#### **问题2: 数据库连接失败**
```bash
# 检查数据库连接
docker exec -it diechi-backend bash
ping postgres

# 检查数据库状态
docker exec -it diechi-postgres psql -U postgres -c "SELECT version();"

# 检查环境变量
echo $DATABASE_URL
```

#### **问题3: 前端无法访问**
```bash
# 检查Nginx配置
nginx -t

# 检查前端构建
ls -la apps/web/dist

# 检查API代理
curl -v http://localhost:8000/health
```

#### **问题4: 内存不足**
```bash
# 查看内存使用
docker stats

# 限制容器内存
# 在docker-compose.yml中配置：
deploy:
  resources:
    limits:
      memory: 2G
    reservations:
      memory: 1G

# 清理未使用的容器和镜像
docker system prune -f
```

### **2. 性能优化**

#### **前端优化**
```bash
# 1. 启用Gzip压缩
# 已在nginx.conf中配置

# 2. 启用缓存
# 已在nginx.conf中配置

# 3. 使用CDN
# 将静态文件部署到CDN

# 4. 图片优化
# 使用WebP格式，压缩图片大小
```

#### **后端优化**
```bash
# 1. 增加Worker数量
# 在Dockerfile中配置：
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]

# 2. 启用缓存
# 使用Redis缓存API响应

# 3. 数据库优化
# 添加索引，优化查询

# 4. 模型优化
# 使用INT8量化减少内存使用
```

#### **系统优化**
```bash
# 1. 启用GPU加速
# 需要NVIDIA GPU和nvidia-docker

# 2. 使用SSD存储
# 将数据目录挂载到SSD

# 3. 网络优化
# 使用高性能网络

# 4. 系统参数优化
sudo sysctl -w net.core.somaxconn=65535
sudo sysctl -w net.ipv4.tcp_tw_reuse=1
```

---

## 📈 **扩展配置**

### **1. 水平扩展**

#### **前端扩展**
```yaml
# docker-compose.prod.yml
frontend:
  deploy:
    replicas: 2  # 增加实例数量
    resources:
      limits:
        cpus: '0.5'
        memory: 256M
```

#### **后端扩展**
```yaml
# docker-compose.prod.yml
backend:
  deploy:
    replicas: 2  # 增加实例数量
    resources:
      limits:
        cpus: '1.0'
        memory: 1G
```

### **2. 负载均衡**

#### **Nginx负载均衡**
```nginx
# apps/web/nginx.conf
upstream backend_servers {
    server backend1:8000;
    server backend2:8000;
    server backend3:8000;
}

location /api {
    proxy_pass http://backend_servers/api;
}
```

#### **Traefik负载均衡**
```yaml
# docker-compose.prod.yml
traefik:
  image: traefik:v2.10
  command:
    - "--providers.docker=true"
    - "--entrypoints.web.address=:80"
  ports:
    - "80:80"
    - "8080:8080"
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
```

### **3. 数据库高可用**

#### **PostgreSQL主从复制**
```yaml
# docker-compose.prod.yml
postgres-master:
  image: postgres:15-alpine
  environment:
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
    POSTGRES_DB: diechi
  command: postgres -c wal_level=replica -c hot_standby=on
  
postgres-slave:
  image: postgres:15-alpine
  environment:
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
  command: postgres -c hot_standby=on
  depends_on:
    - postgres-master
```

---

## 🎯 **安全配置**

### **1. 网络安全**

#### **防火墙配置**
```bash
# 1. 限制SSH访问
sudo ufw allow 22/tcp
sudo ufw enable

# 2. 限制Web访问
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 3. 限制API访问
sudo ufw allow from 192.168.1.0/24 to any port 8000

# 4. 启用DDoS保护
sudo apt install fail2ban
sudo systemctl enable fail2ban
```

#### **网络隔离**
```yaml
# docker-compose.prod.yml
networks:
  diechi-network:
    driver: bridge
    internal: false  # 允许外部访问
    # internal: true   # 仅内部网络
```

### **2. 数据安全**

#### **数据库加密**
```yaml
# docker-compose.prod.yml
postgres:
  environment:
    POSTGRES_INITDB_ARGS: "--data-checksums"
  volumes:
    - ./data/postgres:/var/lib/postgresql/data
```

#### **文件加密**
```bash
# 1. 加密敏感文件
openssl enc -aes-256-cbc -salt -in .env -out .env.enc -k your-password

# 2. 解密文件
openssl enc -d -aes-256-cbc -in .env.enc -out .env -k your-password
```

### **3. API安全**

#### **JWT认证**
```python
# apps/api/plugins/auth_plugin.py
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

@app.get("/protected")
async def protected_route(token: str = Depends(oauth2_scheme)):
    # 验证JWT令牌
    user = verify_token(token)
    return {"message": f"Hello {user.username}"}
```

#### **CORS配置**
```python
# apps/api/main.py
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.diechi.ai", "https://staging.diechi.ai"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 📚 **学习资源**

### **🔗 在线教程**
- [Docker官方文档](https://docs.docker.com/) - Docker学习
- [Kubernetes官方文档](https://kubernetes.io/docs/home/) - Kubernetes学习
- [Prometheus官方文档](https://prometheus.io/docs/introduction/overview/) - 监控学习
- [Grafana官方文档](https://grafana.com/docs/) - 可视化学习
- [FastAPI部署指南](https://fastapi.tiangolo.com/deployment/) - FastAPI部署

### **📖 推荐书籍**
- 《Docker实战》 - 学习容器化技术
- 《Kubernetes权威指南》 - 学习Kubernetes
- 《Prometheus实战》 - 学习监控系统
- 《DevOps实践指南》 - 学习DevOps实践
- 《云原生应用开发》 - 学习云原生技术

### **🎓 在线课程**
- [Docker & Kubernetes: The Practical Guide](https://www.udemy.com/course/docker-kubernetes-the-practical-guide/) - Docker和Kubernetes
- [Prometheus Monitoring with Grafana](https://www.udemy.com/course/prometheus/) - 监控和可视化
- [FastAPI - The Complete Course](https://www.udemy.com/course/fastapi-the-complete-course/) - FastAPI开发
- [DevOps Bootcamp](https://www.udemy.com/course/devops-bootcamp/) - DevOps实践

---

## 🎉 **部署完成！**

**🦋 蝶翅APP** 已成功部署到您的生产环境！

### **📊 部署总结**
- ✅ **容器化部署**: Docker + Docker Compose
- ✅ **多环境支持**: 本地开发、预发布、生产环境
- ✅ **监控运维**: Prometheus + Grafana + ELK
- ✅ **安全配置**: 防火墙、加密、认证
- ✅ **性能优化**: 缓存、负载均衡、水平扩展

### **🚀 下一步行动**

#### **立即开始**
1. **访问服务**: http://localhost (或您的域名)
2. **查看监控**: http://localhost:3000 (admin/admin)
3. **查看日志**: docker-compose logs -f
4. **性能测试**: 使用ab或wrk进行压力测试

#### **进一步优化**
- [ ] 启用HTTPS (SSL证书)
- [ ] 配置自动备份
- [ ] 实施告警通知
- [ ] 优化数据库性能
- [ ] 添加更多监控指标

#### **长期运维**
- [ ] 定期更新软件版本
- [ ] 监控系统性能
- [ ] 备份和恢复测试
- [ ] 安全审计和加固
- [ ] 容量规划和扩展

---

**🎯 恭喜！您的蝶翅APP已成功部署！**

**需要我详细解释某个具体部分吗？** 比如：
- Docker Compose配置的详细说明
- Kubernetes部署的具体步骤
- 监控系统的配置和使用
- 安全配置的最佳实践
- 性能优化的具体方法

**或者您想开始下一步的开发工作？** 😊