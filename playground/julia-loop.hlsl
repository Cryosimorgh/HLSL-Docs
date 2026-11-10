// Julia-set escape-time fractal. REAL GPU animation when b0.Phase changes.
// 128x128 float4 positions from the grid preset at t0; u0 stores intensity.
// HLSL CSMain compiles once. Each animation frame updates Phase and dispatches.
cbuffer JuliaSettings : register(b0)
{
    float Phase;  // time, advanced by the Workbench on each frame
    float Zoom;
    float PanX;
    float PanY;
};
StructuredBuffer<float4> Input : register(t0);
RWStructuredBuffer<float4> Output : register(u0);

[numthreads(64,1,1)]
void CSMain(uint3 tid : SV_DispatchThreadID)
{
    uint i = tid.x;
    if (i >= 16384u) return;
    float2 uv = Input[i].xy;
    float2 z = (uv - float2(0.5f,0.5f)) * (3.0f / max(Zoom,0.01f))
             + float2(PanX,PanY);
    float2 c = float2(-0.745f + 0.13f * cos(Phase*0.33f),
                       0.186f + 0.12f * sin(Phase*0.27f));
    uint iterations = 0u;
    [loop]
    for (uint n = 0u; n < 100u; ++n)
    {
        if (dot(z,z) > 16.0f) break;
        z = float2(z.x*z.x - z.y*z.y, 2.0f*z.x*z.y) + c;
        iterations++;
    }
    float intensity = (float)iterations / 100.0f;
    Output[i] = float4(uv.x, uv.y, intensity, 1.0f);
}
