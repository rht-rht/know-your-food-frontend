import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const incomingFormData = await request.formData();
    const file = incomingFormData.get('file');
    
    if (!file || !(file instanceof Blob)) {
      console.error('[API Proxy] No audio file in request');
      return NextResponse.json(
        { error: 'No audio file uploaded' },
        { status: 400 }
      );
    }

    const forwardFormData = new FormData();
    const blob = file instanceof File ? file : new File([file], 'audio.webm', { type: 'audio/webm' });
    forwardFormData.append('file', blob, 'audio.webm');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 280000);
    
    const response = await fetch(`${BACKEND_URL}/analyze/audio`, {
      method: 'POST',
      body: forwardFormData,
      signal: controller.signal,
    });
    
    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API Proxy] Audio backend error:', errorText);
      let detail = errorText;
      try {
        const errJson = JSON.parse(errorText);
        detail = errJson.detail || errJson.error || errorText;
      } catch {
        // use raw errorText
      }
      return NextResponse.json(
        { detail: detail, error: detail },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[API Proxy] Audio error:', error.message || error);
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
