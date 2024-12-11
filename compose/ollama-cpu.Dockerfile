# Example taken from https://github.com/alpine-docker/ollama/blob/master/Dockerfile.llama3.2

FROM ollama/ollama AS ollama

FROM cgr.dev/chainguard/wolfi-base

RUN apk add --no-cache libstdc++

COPY --from=ollama /usr/bin/ollama /usr/bin/ollama
COPY --from=ollama /usr/lib/ollama/runners/cpu /usr/lib/ollama/runners/cpu
COPY --from=ollama /usr/lib/ollama/runners/cpu_avx /usr/lib/ollama/runners/cpu_avx
COPY --from=ollama /usr/lib/ollama/runners/cpu_avx2 /usr/lib/ollama/runners/cpu_avx2

# In arm64 ollama/ollama image, there is no avx libraries and seems they are not must-have (#2903, #3891)
# COPY --from=ollama /usr/lib/ollama/runners/cpu_avx /usr/lib/ollama/runners/cpu_avx
# COPY --from=ollama /usr/lib/ollama/runners/cpu_avx2 /usr/lib/ollama/runners/cpu_avx2

# Environment variable setup
ENV GIN_MODE=release
ENV OLLAMA_KEEP_ALIVE=24h
ENV OLLAMA_FLASH_ATTENTION=false
ENV OLLAMA_NOHISTORY=false
ENV OLLAMA_HOST=0.0.0.0
ENV OLLAMA_HISTORY="/tmp/ollama"
ENV OLLAMA_TMPDIR="/tmp/ollama"
ENV OLLAMA_ORIGINS=*
ENV OLLAMA_MODELS=/models
ENV ANONYMIZED_TELEMETRY=False

# ROCm for the gfx90c iGPU
ENV OLLAMA_LLM_LIBRARY=rocm_v60002
ENV HCC_AMDGPU_TARGETS=gfx902
ENV HSA_OVERRIDE_GFX_VERSION=9.0.0
ENV HSA_ENABLE_SDMA=0

ENV OLLAMA_DEBUG=1

# In this image, we download llama3.2 model directly
RUN ollama serve & sleep 5 && ollama pull llama3.2:1b 
#      /usr/bin/ollama pull llama3.2:3b \
#     /usr/bin/ollama pull nomic-embed-text:latest

# Expose port for the service
EXPOSE 11434

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 CMD [ "curl --fail http://localhost:11434 || exit 1" ]

ENTRYPOINT ["/usr/bin/ollama"]
CMD ["serve"]