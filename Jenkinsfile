pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
        timestamps()
    }

    environment {
        PROJECT_NAME = 'wisepencloud'
        DOCKER_REGISTRY = 'local'
    }

    parameters {
        string(name: 'BRANCH_NAME', defaultValue: 'main', description: '选择需要构建的 Git 分支')
        booleanParam(name: 'DEPLOY_AFTER_BUILD', defaultValue: true, description: '构建成功后是否执行部署')
        booleanParam(name: 'PUSH_TO_REGISTRY', defaultValue: false, description: '是否额外上传镜像到用户指定的制品仓')
        string(name: 'REGISTRY_HOST', defaultValue: '', description: '制品仓主机名和可选端口，不包含协议或路径')
        string(name: 'REGISTRY_NAMESPACE', defaultValue: '', description: '制品仓命名空间，例如 wisepen')
    }

    stages {
        stage('1. 拉取代码 (Checkout)') {
            steps {
                script {
                    def remoteUrl = scm.userRemoteConfigs[0].url
                    echo "开始从 ${remoteUrl} 拉取边车项目 ${params.BRANCH_NAME} 分支代码..."
                    deleteDir()
                    git branch: params.BRANCH_NAME, url: remoteUrl
                    env.GIT_COMMIT_FULL = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                    env.IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    sh 'git status --short --branch'
                    echo "代码拉取成功，Commit: ${env.GIT_COMMIT_FULL}，镜像 TAG: ${env.IMAGE_TAG}"
                }
            }
        }

        stage('2. 并行构建并推送镜像 (Docker Build & Push)') {
            failFast true

            parallel {
                stage('Note Collab Service') {
                    steps {
                        echo "开始执行 Node.js 多阶段构建..."
                        script {
                            dir('wisepen-note-collab-service') {
                                // 构建镜像并打上 Git Hash Tag 和 latest Tag
                                sh "docker build -t ${DOCKER_REGISTRY}/${PROJECT_NAME}-note-collab:${IMAGE_TAG} -t ${DOCKER_REGISTRY}/${PROJECT_NAME}-note-collab:latest ."
                            }
                        }
                    }
                }
            }
        }

        stage('2.5 上传镜像到制品仓 (Push Registry)') {
            when {
                expression { return params.PUSH_TO_REGISTRY }
            }
            steps {
                script {
                    if (!params.REGISTRY_HOST?.trim() || params.REGISTRY_HOST.contains('://') || params.REGISTRY_HOST.contains('/')) {
                        error 'REGISTRY_HOST 必须填写主机名和可选端口，不能包含协议或路径。'
                    }
                    if (!params.REGISTRY_NAMESPACE?.trim()) {
                        error '启用制品仓上传时必须填写 REGISTRY_NAMESPACE。'
                    }
                    withCredentials([
                        usernamePassword(
                            credentialsId: 'docker-registry-credentials',
                            usernameVariable: 'REGISTRY_USERNAME',
                            passwordVariable: 'REGISTRY_PASSWORD'
                        )
                    ]) {
                        withEnv([
                            "REGISTRY_HOST=${params.REGISTRY_HOST.trim()}",
                            "REGISTRY_NAMESPACE=${params.REGISTRY_NAMESPACE.trim()}"
                        ]) {
                            sh '''
                            set -eu
                            DOCKER_CONFIG="$(mktemp -d)"
                            export DOCKER_CONFIG
                            trap 'rm -rf "$DOCKER_CONFIG"' EXIT
                            printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" \
                                --username "$REGISTRY_USERNAME" --password-stdin
                            source_image="${DOCKER_REGISTRY}/${PROJECT_NAME}-note-collab:${IMAGE_TAG}"
                            target_image="${REGISTRY_HOST}/${REGISTRY_NAMESPACE}/${PROJECT_NAME}-note-collab:${IMAGE_TAG}"
                            docker tag "$source_image" "$target_image"
                            docker push "$target_image"
                            '''
                        }
                    }
                }
            }
        }

        stage('3. 自动化部署 (Deploy)') {
            when {
                expression { return params.DEPLOY_AFTER_BUILD }
            }
            environment {
                NACOS_USER = credentials('nacos-username')
                NACOS_PWD  = credentials('nacos-password')
            }
            steps {
                script {
                    echo "开始部署 Sidecar 最新版本: ${IMAGE_TAG} ..."

                    sh """
                    set -eu
                    docker-compose version

                    export APP_VERSION=${IMAGE_TAG}
                    export DOCKER_REGISTRY=${DOCKER_REGISTRY}
                    export NACOS_USERNAME=\${NACOS_USER}
                    export NACOS_PASSWORD=\${NACOS_PWD}

                    docker network create wisepen-net 2>/dev/null || true
                    docker-compose \
                        -p wisepen-cloud-sidecar \
                        -f docker-compose-app.yml \
                        up -d --no-build --force-recreate --remove-orphans
                    """
                }
            }
        }
    }

    post {
        always {
            echo "执行 Docker 垃圾回收..."
            sh 'docker image prune -f'
        }
        success {
            script {
                echo(params.DEPLOY_AFTER_BUILD
                    ? "构建与部署大功告成！版本: ${IMAGE_TAG}"
                    : "构建完成，已按 build-only 模式跳过部署！版本: ${IMAGE_TAG}")
            }
        }
        failure {
            echo "流水线执行失败，请检查 Jenkins 控制台报错日志！"
        }
    }
}
