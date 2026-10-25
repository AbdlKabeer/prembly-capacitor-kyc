export interface PremblyDevicePlugin {
  echo(options: { value: string }): Promise<{ value: string }>;
}
