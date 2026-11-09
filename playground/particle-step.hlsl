// HLSL Compute Playground — real, DXC-compilable compute shader.
// The browser demo in index.html simulates equivalent math in JavaScript.
// It does NOT execute this HLSL file.
// Compile: dxc -T cs_6_0 -E CSMain -D GROUP_SIZE=64 -Fo particle-step.dxil particle-step.hlsl

#ifndef GROUP_SIZE
#define GROUP_SIZE 64
#endif

struct Ball
{
    float2 position;  // world units: x increases right, y increases down
    float2 velocity;  // world units per second
};

StructuredBuffer<Ball> Source : register(t0);      // immutable read snapshot
RWStructuredBuffer<Ball> Destination : register(u0); // independent output

cbuffer Params : register(b0)
{
    float dt;           // integration seconds per step
    float gravity;      // downward acceleration in world units / second^2
    float bounce;       // wall restitution in [0,1]
    float drag;         // exponential damping per second

    uint count;         // number of live bodies, <= allocated capacity
    float radius;       // world-space ball radius
    float worldWidth;   // x-extent; y always uses [0,1]
    float padding;      // complete the second 16-byte cbuffer register
};

[numthreads(GROUP_SIZE, 1, 1)]
void CSMain(uint3 tid : SV_DispatchThreadID)
{
    uint i = tid.x;
    if (i >= count) return; // final workgroup can contain idle lanes

    Ball b = Source[i];
    b.velocity.y += gravity * dt;           // acceleration -> velocity
    b.velocity *= exp(-drag * dt);          // stable exponential damping
    b.position += b.velocity * dt;          // velocity -> position

    float left = radius;
    float right = worldWidth - radius;
    float top = radius;
    float bottom = 1.0f - radius;

    if (b.position.x < left)
    {
        b.position.x = left;
        b.velocity.x = abs(b.velocity.x) * bounce;
    }
    else if (b.position.x > right)
    {
        b.position.x = right;
        b.velocity.x = -abs(b.velocity.x) * bounce;
    }

    if (b.position.y < top)
    {
        b.position.y = top;
        b.velocity.y = abs(b.velocity.y) * bounce;
    }
    else if (b.position.y > bottom)
    {
        b.position.y = bottom;
        b.velocity.y = -abs(b.velocity.y) * bounce;
    }

    Destination[i] = b;
}
