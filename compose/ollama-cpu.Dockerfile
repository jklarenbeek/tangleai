# Example taken from https://github.com/alpine-docker/ollama/blob/master/Dockerfile.llama3.2

FROM ollama/ollama AS ollama

FROM cgr.dev/chainguard/wolfi-base

RUN apk add --no-cache libstdc++

COPY --from=ollama /usr/bin/ollama /usr/bin/ollama
COPY --from=ollama /usr/lib/ollama/runners/cpu /usr/lib/ollama/runners/cpu

# In arm64 ollama/ollama image, there is no avx libraries and seems they are not must-have (#2903, #3891)
# COPY --from=ollama /usr/lib/ollama/runners/cpu_avx /usr/lib/ollama/runners/cpu_avx
# COPY --from=ollama /usr/lib/ollama/runners/cpu_avx2 /usr/lib/ollama/runners/cpu_avx2

# In this image, we download llama3.2 model directly
RUN /usr/bin/ollama serve & sleep 5 && \
      /usr/bin/ollama pull llama3.2:1b \
      /usr/bin/ollama pull llama3.2:3b \
      /usr/bin/ollama pull nomic-embed-text:latest

# Environment variable setup
ENV OLLAMA_HOST=0.0.0.0

# Expose port for the service
EXPOSE 11434

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 CMD [ "curl --fail http://localhost:11434 || exit 1" ]

ENTRYPOINT ["/usr/bin/ollama"]
CMD ["serve"]