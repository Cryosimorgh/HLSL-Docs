// Pure HLSL GPU-rendered moving particles.
// Each pixel receives its RGB color from this shader, NOT from JavaScript.
// Particles follow independent triangular-wave bouncing trajectories.
// This is a procedural visual demo, not an inter-particle collision solver.
#define WORKBENCH_WIDTH 256
#define WORKBENCH_HEIGHT 256
cbuffer WorkbenchFrame : register(b7)
{
    float Time;
    float DeltaTime;
    float Width;
    float Height;
    float Frame;
    float Padding0;
    float Padding1;
    float Padding2;
};
RWStructuredBuffer<float4> Framebuffer : register(u0);

float Hash(float x) { return frac(sin(x * 127.1f) * 43758.5453f); }
float2 Bounce(float2 v) { return 1.0f - abs(frac(v) * 2.0f - 1.0f); }

[numthreads(8, 8, 1)]
void CSMain(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x >= WORKBENCH_WIDTH || tid.y >= WORKBENCH_HEIGHT) return;
    uint i = tid.y * WORKBENCH_WIDTH + tid.x;
    float2 uv = (float2(tid.xy) + 0.5f) /
                float2(WORKBENCH_WIDTH, WORKBENCH_HEIGHT);

    float3 rgb = float3(0.009f, 0.016f, 0.028f);
    float2 coord = uv;
    for (uint p = 0u; p < 24u; ++p)
    {
        float k = float(p) + 1.0f;
        float2 start = float2(Hash(k * 1.3f), Hash(k * 2.1f));
        float2 velocity = float2(0.08f + 0.10f*Hash(k*3.7f),
                                  0.07f + 0.11f*Hash(k*4.3f));
        float2 pos = 0.08f + 0.84f *
          Bounce(start + Time * velocity * float2(1.0f, 1.2f));
        float2 diff = coord - pos;
        float d2 = dot(diff, diff);
        float radius = 0.010f + 0.009f * Hash(k*5.3f);
        float core = 1.0f - smoothstep(radius*0.6f, radius, sqrt(d2));
        float halo = exp(-d2 / (radius*radius*9.0f)) * 0.22f;
        float3 particle = float3(
            0.30f + 0.70f*Hash(k*6.7f),
            0.35f + 0.65f*Hash(k*7.7f),
            0.42f + 0.58f*Hash(k*8.7f)
        );
        rgb += particle * (core + halo);
    }
    Framebuffer[i] = float4(saturate(rgb), 1.0f);
}
