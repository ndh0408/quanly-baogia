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

{{- define "quanly.databaseUrl" -}}
{{- if .Values.postgres.enabled -}}
postgresql://quanly:CHANGE_ME_INTERNAL@{{ include "quanly.fullname" . }}-postgres:5432/quanly?schema=public
{{- else -}}
{{ .Values.secrets.DATABASE_URL }}
{{- end -}}
{{- end -}}

{{- define "quanly.redisUrl" -}}
{{- if .Values.redis.enabled -}}
redis://{{ include "quanly.fullname" . }}-redis:6379
{{- else -}}
{{ .Values.secrets.REDIS_URL }}
{{- end -}}
{{- end -}}
