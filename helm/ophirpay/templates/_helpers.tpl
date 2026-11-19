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

{{/*
Name of the Secret the pods read their environment from (issue #1334).

When `secrets.existingSecret` is set the chart renders no Secret at all and
points the Deployment at the pre-existing one instead, so an operator can keep
credentials in External Secrets / Sealed Secrets / Vault. Otherwise the chart
renders `<fullname>-secrets` from `.Values.secrets`.
*/}}
{{- define "ophirpay.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- printf "%s-secrets" (include "ophirpay.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Fully qualified image reference (issue #1333).

`image.tag` is empty by default so the chart falls back to `Chart.appVersion`
(1.0.0) instead of the mutable `latest` tag: two pods of one release can no
longer run different builds, and `helm rollback` really rolls the code back.
Setting `image.digest` pins the image by content instead of by name.
*/}}
{{- define "ophirpay.image" -}}
{{- $repository := required "image.repository must be set to the registry/repository of the OphirPay image" .Values.image.repository -}}
{{- if .Values.image.digest }}
{{- $digest := .Values.image.digest -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" $digest) -}}
{{- fail (printf "image.digest must be an immutable sha256 digest of the form 'sha256:<64 hex chars>' (got %q). Remove image.digest to fall back to image.tag / Chart.appVersion." $digest) -}}
{{- end -}}
{{- printf "%s@%s" $repository $digest -}}
{{- else -}}
{{- printf "%s:%s" $repository (.Values.image.tag | default .Chart.AppVersion) -}}
{{- end -}}
{{- end }}

{{/* Migration companion image uses the same release tag plus `-migrator`. */}}
{{- define "ophirpay.migratorImage" -}}
{{- $repository := default .Values.image.repository .Values.migrations.image.repository -}}
{{- $baseTag := default .Chart.AppVersion .Values.image.tag -}}
{{- $tag := default (printf "%s-migrator" $baseTag) .Values.migrations.image.tag -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end }}
