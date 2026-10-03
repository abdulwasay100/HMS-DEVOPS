output "backend_url" {
  description = "Cloud Run backend URL"
  value       = google_cloud_run_v2_service.hms_backend.uri
}

output "frontend_url" {
  description = "Cloud Run frontend URL"
  value       = google_cloud_run_v2_service.hms_frontend.uri
}

output "cloud_sql_instance" {
  description = "Cloud SQL instance name"
  value       = google_sql_database_instance.hms_mysql.name
}

output "artifact_registry_repository" {
  description = "Artifact Registry repository"
  value       = google_artifact_registry_repository.hms_repo.name
}

output "vpc_connector" {
  description = "Serverless VPC Access connector"
  value       = google_vpc_access_connector.hms_connector.name
}
