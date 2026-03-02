import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[API Proxy] /analyze request:', JSON.stringify(body).slice(0, 200));
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 110000);
    
    const response = await fetch(`${BACKEND_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);

    console.log('[API Proxy] Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API Proxy] Backend error:', errorText);
      return NextResponse.json(
        { error: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[API Proxy] Success, returning data');
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[API Proxy] Error:', error.message || error);
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request timeout - analysis is taking too long' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to connect to backend: ' + (error.message || 'Unknown error') },
      { status: 502 }
    );
  }
}
