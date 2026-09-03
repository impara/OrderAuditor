#!/usr/bin/env bash
set -Eeuo pipefail

# Canonical Duplicate Guard production release path. GitHub Actions publishes
# sha-<full-commit> images; this script deploys only the image matching the
# clean, fast-forwarded production checkout.

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"
REGISTRY_IMAGE="ghcr.io/impara/orderauditor"
DEPLOY_BRANCH=${DEPLOY_BRANCH:-main}
ACTIVE_PORT=5000
BLUE_SERVICE="app_blue"
GREEN_SERVICE="app_green"
BLUE_CONTAINER="duplicate-guard-app-blue"
GREEN_CONTAINER="duplicate-guard-app-green"
IMAGE_WAIT_ATTEMPTS=${IMAGE_WAIT_ATTEMPTS:-60}
IMAGE_WAIT_SECONDS=${IMAGE_WAIT_SECONDS:-10}
READINESS_MAX_ATTEMPTS=${READINESS_MAX_ATTEMPTS:-60}
READINESS_INTERVAL_SECONDS=${READINESS_INTERVAL_SECONDS:-5}

log() {
  printf '\n%s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

image_for_commit() {
  local commit_sha=$1
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || fail "checkout revision is not a full 40-character commit SHA"
  printf '%s:sha-%s\n' "$REGISTRY_IMAGE" "$commit_sha"
}

verify_image_revision() {
  local expected_revision=$1
  local actual_revision=$2
  [[ "$actual_revision" == "$expected_revision" ]] || \
    fail "image revision $actual_revision does not match checkout $expected_revision"
}

wait_for_service_ready() {
  local service=$1
  local attempt=0
  local container_id
  local health

  printf 'Waiting for %s to become ready (max %s attempts)...\n' "$service" "$READINESS_MAX_ATTEMPTS"
  while [[ "$attempt" -lt "$READINESS_MAX_ATTEMPTS" ]]; do
    container_id=$(compose ps -q "$service" || true)

    if [[ -z "$container_id" ]]; then
      printf 'Container for %s not started yet (attempt %d/%s)\n' \
        "$service" "$((attempt + 1))" "$READINESS_MAX_ATTEMPTS"
      attempt=$((attempt + 1))
      sleep "$READINESS_INTERVAL_SECONDS"
      continue
    fi

    health=$(docker inspect --format='{{.State.Health.Status}}' "$container_id" 2>/dev/null || printf 'starting')
    printf '%s health status: %s (attempt %d/%s)\n' \
      "$service" "$health" "$((attempt + 1))" "$READINESS_MAX_ATTEMPTS"

    if [[ "$health" == "healthy" ]]; then
      return 0
    fi

    attempt=$((attempt + 1))
    sleep "$READINESS_INTERVAL_SECONDS"
  done

  printf 'ERROR: %s did not become ready within the allotted time.\n' "$service" >&2
  return 1
}

bind_service_to_port() {
  local service=$1
  local image_override=${2:-}

  if [[ -n "$image_override" ]]; then
    docker compose \
      -f "$COMPOSE_FILE" \
      -f <(printf "services:\n  %s:\n    image: '%s'\n    ports:\n      - '%s:5000'\n" \
        "$service" "$image_override" "$ACTIVE_PORT") \
      up -d --no-deps --force-recreate "$service"
  else
    docker compose \
      -f "$COMPOSE_FILE" \
      -f <(printf "services:\n  %s:\n    ports:\n      - '%s:5000'\n" "$service" "$ACTIVE_PORT") \
      up -d --no-deps --force-recreate "$service"
  fi
}

start_service_without_host_port() {
  local service=$1
  docker compose \
    -f "$COMPOSE_FILE" \
    -f <(printf "services:\n  %s:\n    ports: !reset []\n" "$service") \
    up -d --no-deps --force-recreate "$service"
}

rollback_to_service() {
  local service=$1
  local previous_image_id=$2
  printf 'Rolling back traffic to %s on port %s...\n' "$service" "$ACTIVE_PORT"
  bind_service_to_port "$service" "$previous_image_id"
  wait_for_service_ready "$service"
}

detect_active_service() {
  local published_container
  published_container=$(docker ps --filter "publish=$ACTIVE_PORT" --format '{{.Names}}')

  case "$published_container" in
    "$BLUE_CONTAINER")
      ACTIVE=$BLUE_SERVICE
      INACTIVE=$GREEN_SERVICE
      ACTIVE_CONTAINER=$BLUE_CONTAINER
      ;;
    "$GREEN_CONTAINER")
      ACTIVE=$GREEN_SERVICE
      INACTIVE=$BLUE_SERVICE
      ACTIVE_CONTAINER=$GREEN_CONTAINER
      ;;
    *)
      fail "expected exactly one Duplicate Guard container to publish port $ACTIVE_PORT; found: ${published_container:-none}"
      ;;
  esac
}

main() {
  cd "$SCRIPT_DIR"

  command -v git >/dev/null || fail "git is required"
  command -v docker >/dev/null || fail "docker is required"
  [[ -f "$COMPOSE_FILE" ]] || fail "$COMPOSE_FILE is missing"
  docker compose version >/dev/null || fail "Docker Compose v2 is required"

  if [[ -n "$(git status --porcelain)" ]]; then
    fail "production checkout is not clean; reconcile tracked and untracked files before deploying"
  fi

  local branch
  branch=$(git branch --show-current)
  [[ -n "$branch" ]] || fail "production checkout must be on a branch"
  [[ "$branch" == "$DEPLOY_BRANCH" ]] || \
    fail "production checkout must be on $DEPLOY_BRANCH (currently $branch)"

  log "Updating $DEPLOY_BRANCH from origin"
  local head_before
  local head_after
  head_before=$(git rev-parse HEAD)
  git fetch origin "$DEPLOY_BRANCH"
  git merge --ff-only "origin/$DEPLOY_BRANCH"
  head_after=$(git rev-parse HEAD)

  # A fast-forward can update this script. Re-exec the version belonging to the
  # selected commit before deriving or deploying its image.
  if [[ "$head_before" != "$head_after" ]]; then
    log "Deployment files updated; restarting deploy.sh from $head_after"
    exec bash "$SCRIPT_DIR/deploy.sh"
  fi

  local commit_sha=$head_after
  ORDERAUDITOR_IMAGE=$(image_for_commit "$commit_sha")
  export ORDERAUDITOR_IMAGE

  log "Waiting for GitHub Actions image $ORDERAUDITOR_IMAGE"
  local image_ready=false
  local attempt
  for ((attempt = 1; attempt <= IMAGE_WAIT_ATTEMPTS; attempt++)); do
    if docker pull "$ORDERAUDITOR_IMAGE"; then
      image_ready=true
      break
    fi
    printf 'Image not ready (%d/%d); retrying in %ss\n' \
      "$attempt" "$IMAGE_WAIT_ATTEMPTS" "$IMAGE_WAIT_SECONDS"
    sleep "$IMAGE_WAIT_SECONDS"
  done
  [[ "$image_ready" == "true" ]] || \
    fail "image was not published; inspect the GitHub Actions Build and Push run"

  local image_revision
  image_revision=$(docker image inspect \
    --format='{{index .Config.Labels "org.opencontainers.image.revision"}}' \
    "$ORDERAUDITOR_IMAGE")
  verify_image_revision "$commit_sha" "$image_revision"
  compose config --quiet

  log "Detecting active service"
  detect_active_service
  printf 'Active service: %s\nDeploying to inactive service: %s\n' "$ACTIVE" "$INACTIVE"

  local previous_image_id
  previous_image_id=$(docker inspect --format='{{.Image}}' "$ACTIVE_CONTAINER")
  [[ -n "$previous_image_id" ]] || fail "could not capture the active image for rollback"

  log "Pulling the verified image for $INACTIVE"
  compose pull "$INACTIVE"

  log "Running database schema migration from the verified image"
  compose run --rm --no-deps "$INACTIVE" npm run db:migrate

  log "Starting $INACTIVE for pre-warm without host port"
  start_service_without_host_port "$INACTIVE"

  if ! wait_for_service_ready "$INACTIVE"; then
    printf 'ERROR: Pre-warm readiness failed. Aborting deploy without swapping ports.\n' >&2
    compose stop "$INACTIVE" || true
    exit 1
  fi

  printf '%s passed pre-warm readiness. Swapping ports...\n' "$INACTIVE"
  printf 'Stopping active service: %s\n' "$ACTIVE"
  compose stop "$ACTIVE"

  printf 'Binding %s to host port %s...\n' "$INACTIVE" "$ACTIVE_PORT"
  bind_service_to_port "$INACTIVE"

  if ! wait_for_service_ready "$INACTIVE"; then
    printf 'ERROR: Post-swap readiness failed. Rolling back to %s...\n' "$ACTIVE" >&2
    compose stop "$INACTIVE" || true
    if ! rollback_to_service "$ACTIVE" "$previous_image_id"; then
      printf 'CRITICAL: Rollback to %s failed. Manual intervention required.\n' "$ACTIVE" >&2
      exit 1
    fi
    printf 'Rollback complete. %s is serving traffic again.\n' "$ACTIVE"
    exit 1
  fi

  printf 'Deployment complete. %s is serving traffic on port %s.\n' "$INACTIVE" "$ACTIVE_PORT"
  printf 'Commit: %s\nImage: %s\n' "$commit_sha" "$ORDERAUDITOR_IMAGE"
  printf 'Note: a brief downtime window may occur during the port swap.\n'

  log "Cleaning up old unused Docker images"
  docker image prune -af --filter "until=24h" >/dev/null 2>&1 || true
  printf 'Docker cleanup complete.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
