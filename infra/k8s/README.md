# Kubernetes manifests

Plain YAML manifests for production deployment. Override the image tag and
secret values for your cluster.

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
- Use S3 / R2 / GCS — `minio.yaml` is included for self-hosted only.
- Configure HorizontalPodAutoscaler on `app` and `worker`.
- Wire Prometheus annotations on services for metrics scraping.
- Set up cert-manager + Let's Encrypt for `ingress.yaml`.
