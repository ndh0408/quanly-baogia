# Kubernetes manifests

> ⚠️ **CHƯA DÙNG CHO PRODUCTION.** Production chạy `docker compose` trên MỘT VM qua `deploy.sh`
> (xem docs/operations/DEPLOYMENT.md). Các manifest này là đường dự phòng, được kiểm schema
> (`kubeconform`, bước [9/13] của `npm run verify`) nhưng CHƯA từng được `kubectl apply` vào cụm
> thật nào. Audit 2026-09-22 (DOC-15 / INFRA-08) tìm thấy lỗi chỉ lộ khi chạy thật (NetworkPolicy
> chặn CronJob backup — đã vá; cổng đếm object của backup-objects — CHƯA vá, xem chú thích trong
> tệp). Đọc kỹ trước khi dùng. Bản cũ của dòng này ghi "manifests for production deployment" — sai.

Plain YAML manifests. Override the image tag and secret values for your cluster.

## Layout

```
infra/k8s/
├── namespace.yaml
├── configmap.yaml          ← non-secret tunables
├── secret.example.yaml     ← copy to secret.yaml and fill, then `kubectl apply -f` (DO NOT COMMIT)
├── postgres.yaml           ← StatefulSet (use a managed DB in real prod)
├── redis.yaml              ← Deployment + Service
├── app.yaml                ← Deployment + Service for the API
├── worker.yaml             ← Deployment for the BullMQ worker
├── ingress.yaml            ← nginx-ingress example with TLS
├── networkpolicy.yaml      ← chỉ pod `app: quanly` vào được Postgres/Redis
├── pdb.yaml                ← PodDisruptionBudget cho api + worker
├── backup-cronjob.yaml     ← pg_dump hằng ngày vào PVC
├── backup-objects-cronjob.yaml ← gương kho object (xem cảnh báo trong tệp)
└── kustomization.yaml      ← convenience for `kubectl apply -k`
```

## Quick start

```bash
# 1. Create namespace
kubectl apply -f namespace.yaml

# 2. Provision secrets (do NOT commit the filled file)
cp secret.example.yaml secret.yaml
# edit secret.yaml with real DATABASE_URL, SESSION_SECRET, S3 keys, etc.
kubectl apply -f secret.yaml

# 3. Apply the rest
kubectl apply -k .
```

## Production checklist

- Use a managed PostgreSQL (RDS / Cloud SQL / Supabase). The `postgres.yaml`
  here is for non-prod environments only.
- Use a managed Redis (ElastiCache / Upstash).
- Use S3 / R2 / GCS. (Bản cũ nhắc `minio.yaml` — tệp đó KHÔNG tồn tại trong thư mục này.)
- Configure HorizontalPodAutoscaler on `app` and `worker`.
- Wire Prometheus annotations on services for metrics scraping.
- Set up cert-manager + Let's Encrypt for `ingress.yaml`.
