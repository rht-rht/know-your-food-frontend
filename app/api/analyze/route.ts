import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[API Proxy] /analyze request:', JSON.stringify(body).slice(0, 200));
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 280000);
    
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
      let detail = errorText;
      try {
        const errJson = JSON.parse(errorText);
        if (errJson.detail) detail = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
      } catch {
        /* use errorText as detail */
      }
      return NextResponse.json(
        { detail, error: errorText },
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
        { detail: 'Request timeout - analysis is taking too long', error: 'Request timeout' },
        { status: 504 }
      );
    }
    const msg = 'Failed to connect to backend. Try again in a moment.';
    return NextResponse.json(
      { detail: msg, error: error.message || 'Unknown error' },
      { status: 502 }
    );
  }
}
