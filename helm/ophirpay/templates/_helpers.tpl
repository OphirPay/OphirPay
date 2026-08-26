{{/*
Expand the name of the chart.
*/}}
{{- define "ophirpay.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "ophirpay.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "ophirpay.labels" -}}
helm.sh/chart: {{ include "ophirpay.name" . }}-{{ .Chart.Version | replace "+" "_" }}
{{ include "ophirpay.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: ophirpay
{{- end }}

{{/*
Selector labels
*/}}
{{- define "ophirpay.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ophirpay.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name
*/}}
{{- define "ophirpay.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "ophirpay.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
