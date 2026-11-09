// Circle-mask HLSL sample for the interactive 32x32 GPU output heatmap.
// 1024 float4 grid positions are generated from the manifest's grid preset.
// DXC: t0 -> WGSL binding 0; u0 -> binding 16; b0 -> binding 32.
// Explicit world-space EdgeWidth avoids unsupported fwidth derivatives.
cbuffer CircleParams : register(b0)
{
    float CircleCenterX;
    float CircleCenterY;
    float CircleRadius;
    float EdgeWidth;
    float SampleCount;     // float32 at byte 16; 1024 in the preset
    float Padding0;        // byte 20
    float Padding1;        // byte 24
    float Padding2;        // byte 28
};

StructuredBuffer<float4> Input : register(t0);
RWStructuredBuffer<float4> Output : register(u0);

[numthreads(64, 1, 1)]
void CSMain(uint3 tid : SV_DispatchThreadID)
{
    uint i = tid.x;
    if (i >= (uint)SampleCount) return;

    float2 pos = Input[i].xy;
    float d = length(pos - float2(CircleCenterX, CircleCenterY));
    float aa = max(EdgeWidth, 0.00001f);
    float mask = 1.0f - smoothstep(CircleRadius - aa, CircleRadius + aa, d);

    Output[i] = float4(pos, mask, 0.0f);
}
