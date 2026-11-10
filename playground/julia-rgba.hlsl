// Pure HLSL animated Julia fractal with its OWN RGB colors.
// The Workbench auto-detects Framebuffer:u0, WorkbenchFrame:b7 and defines.
// No animation manifest or input-position buffer is required.
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

float3 FractalColor(float t)
{
    float3 a = float3(0.02f, 0.04f, 0.10f);
    float3 b = float3(0.04f, 0.45f, 0.68f);
    float3 c = float3(1.00f, 0.55f, 0.20f);
    float3 d = float3(1.00f, 0.90f, 0.62f);
    float3 lower = lerp(a, b, smoothstep(0.0f, 0.4f, t));
    float3 upper = lerp(c, d, smoothstep(0.55f, 1.0f, t));
    return lerp(lower, upper, smoothstep(0.35f, 0.75f, t));
}

[numthreads(8, 8, 1)]
void CSMain(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x >= WORKBENCH_WIDTH || tid.y >= WORKBENCH_HEIGHT) return;
    uint i = tid.y * WORKBENCH_WIDTH + tid.x;
    float2 uv = (float2(tid.xy) + 0.5f) /
                float2(WORKBENCH_WIDTH, WORKBENCH_HEIGHT);

    float2 z = (uv - 0.5f) * 3.1f;
    float2 c = float2(-0.745f + 0.18f * cos(Time * 0.32f),
                       0.186f + 0.14f * sin(Time * 0.23f));
    uint n = 0u;
    float m2 = 0.0f;
    [loop]
    for (uint k = 0u; k < 110u; ++k)
    {
        m2 = dot(z, z);
        if (m2 > 256.0f) break;
        z = float2(z.x*z.x - z.y*z.y, 2.0f*z.x*z.y) + c;
        ++n;
    }
    float escaped = (float)n / 110.0f;
    float3 rgb = FractalColor(saturate(pow(escaped, 0.55f)));
    if (n == 110u) rgb = float3(0.008f, 0.014f, 0.026f);
    Framebuffer[i] = float4(saturate(rgb), 1.0f);
}
