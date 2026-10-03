resource "google_artifact_registry_repository" "hms_repo" {
  location      = "asia-south1"
  repository_id = "hms-repo"
  description   = "HMS Docker images"
  format        = "DOCKER"
}

resource "google_vpc_access_connector" "hms_connector" {
  name          = "hms-connector"
  region        = "asia-south1"
  network       = "default"
  ip_cidr_range = "10.8.0.0/28"
}
