// Compute circle-mask example: compatible with DXC -> SPIR-V -> Naga WGSL.
// Returns float4(position.x, position.y, mask, 0.0) for each input.
// The mask is an explicitly smoothed WORLD-SPACE edge, not fwidth.
// t0 -> WGSL binding 0:  float4 inputs (x, y, unused, unused)
// u0 -> WGSL binding 16: float4 outputs (x, y, mask, 0)
// b0 -> WGSL binding 32: four float32 circle parameters (16 bytes).
cbuffer CircleParams : register(b0)
{
    float CircleCenterX;
    float CircleCenterY;
    float CircleRadius;
    float EdgeWidth;  // Explicit softness in world units (e.g. 0.025)
};

StructuredBuffer<float4> Input : register(t0);
RWStructuredBuffer<float4> Output : register(u0);

[numthreads(64, 1, 1)]
void CSMain(uint3 tid : SV_DispatchThreadID)
{
    uint count, stride;
    Input.GetDimensions(count, stride);
    uint i = tid.x;
    if (i >= count) return;

    float2 p = Input[i].xy;
    float d = length(p - float2(CircleCenterX, CircleCenterY));
    float aa = max(EdgeWidth, 0.00001f);
    float mask = 1.0f - smoothstep(CircleRadius - aa, CircleRadius + aa, d);
    Output[i] = float4(p.x, p.y, mask, 0.0f);
}
