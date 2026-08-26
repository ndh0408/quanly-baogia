{{- define "quanly.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "quanly.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "quanly.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "quanly.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "quanly.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "quanly.selectorLabels" -}}
app.kubernetes.io/name: {{ include "quanly.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "quanly.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{ include "quanly.fullname" . }}
{{- else -}}
default
{{- end -}}
{{- end -}}

{{- define "quanly.secretName" -}}
{{- if .Values.existingSecret -}}
{{ .Values.existingSecret }}
{{- else -}}
{{ include "quanly.fullname" . }}-secrets
{{- end -}}
{{- end -}}

{{/*
  Mật khẩu kho dữ liệu NHÚNG. Đi qua `required` chứ không đọc thẳng .Values: trước đây values.yaml
  mang sẵn placeholder `CHANGE_ME_INTERNAL` / `CHANGE_ME_INTERNAL_REDIS` HỢP LỆ, nên chart cài được
  và chạy được với mật khẩu mà bất kỳ ai đọc repo cũng biết — không có gì buộc người cài phải đổi.
  NetworkPolicy chặn pod lạ là phòng thủ theo mạng, không phải lý do để dùng thông tin đăng nhập
  công khai. Cùng tinh thần với việc chart từ chối image.tag=latest: thà không render còn hơn render
  ra một thứ không an toàn.
*/}}
{{- define "quanly.postgresPassword" -}}
{{- required "postgres.password BAT BUOC khi postgres.enabled=true. Sinh: openssl rand -base64 24" .Values.postgres.password -}}
{{- end -}}

{{- define "quanly.redisPassword" -}}
{{- required "redis.password BAT BUOC khi redis.enabled=true. Sinh: openssl rand -base64 24" .Values.redis.password -}}
{{- end -}}

{{- define "quanly.databaseUrl" -}}
{{- if .Values.postgres.enabled -}}
postgresql://quanly:{{ include "quanly.postgresPassword" . }}@{{ include "quanly.fullname" . }}-postgres:5432/quanly?schema=public
{{- else -}}
{{ .Values.secrets.DATABASE_URL }}
{{- end -}}
{{- end -}}

{{- define "quanly.redisUrl" -}}
{{- if .Values.redis.enabled -}}
redis://:{{ include "quanly.redisPassword" . }}@{{ include "quanly.fullname" . }}-redis:6379
{{- else -}}
{{ .Values.secrets.REDIS_URL }}
{{- end -}}
{{- end -}}

{{/*
  Tham chiếu image DÙNG CHUNG cho app + worker.

  Vì sao có helper này: hai template trước đây tự ghép `{{ .Values.image.repository }}:{{ .Values.image.tag }}`
  với tag mặc định `latest`. Deploy từ tag DI ĐỘNG nghĩa là hai pod của cùng một ReplicaSet có thể
  kéo về hai bản mã khác nhau (node A đã cache `latest` cũ, node B kéo bản mới), và rollback thì
  không có gì để quay về. Ở đây ưu tiên digest (bất biến tuyệt đối), rồi tới tag tường minh, cuối
  cùng mới tới appVersion của chart.
*/}}
{{- define "quanly.image" -}}
{{- $repo := .Values.image.repository -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" $repo .Values.image.digest -}}
{{- else -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- if and (eq $tag "latest") (not .Values.image.allowMutableTag) -}}
{{- fail "image.tag=\"latest\" không dùng cho triển khai thật: đặt image.digest (khuyến nghị) hoặc image.tag=<git-sha>. Chỉ khi thử nghiệm mới đặt image.allowMutableTag=true." -}}
{{- end -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end -}}
