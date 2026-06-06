#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <libusb-1.0/libusb.h>

#define HUAWEI_VENDOR 0x12d1
#define HUAWEI_INSTALL_MODE 0x1f01
#define HUAWEI_HILINK_ECM 0x14db

static void die_libusb(const char *what, int rc) {
    fprintf(stderr, "%s: %s (%d)\n", what, libusb_error_name(rc), rc);
    exit(1);
}

static int find_mass_storage_interface(
    libusb_device_handle *handle,
    uint8_t *interface_number,
    uint8_t *bulk_out,
    uint8_t *bulk_in
) {
    libusb_device *dev = libusb_get_device(handle);
    struct libusb_config_descriptor *config = NULL;
    int rc = libusb_get_active_config_descriptor(dev, &config);
    if (rc != 0) {
        die_libusb("libusb_get_active_config_descriptor", rc);
    }

    int found = 0;
    for (uint8_t i = 0; i < config->bNumInterfaces && !found; i++) {
        const struct libusb_interface *iface = &config->interface[i];
        for (int j = 0; j < iface->num_altsetting && !found; j++) {
            const struct libusb_interface_descriptor *alt = &iface->altsetting[j];
            if (alt->bInterfaceClass != LIBUSB_CLASS_MASS_STORAGE) {
                continue;
            }

            uint8_t out_ep = 0;
            uint8_t in_ep = 0;
            for (uint8_t k = 0; k < alt->bNumEndpoints; k++) {
                const struct libusb_endpoint_descriptor *ep = &alt->endpoint[k];
                const uint8_t attr = ep->bmAttributes & LIBUSB_TRANSFER_TYPE_MASK;
                if (attr != LIBUSB_TRANSFER_TYPE_BULK) {
                    continue;
                }

                if ((ep->bEndpointAddress & LIBUSB_ENDPOINT_DIR_MASK) == LIBUSB_ENDPOINT_IN) {
                    in_ep = ep->bEndpointAddress;
                } else {
                    out_ep = ep->bEndpointAddress;
                }
            }

            if (out_ep != 0) {
                *interface_number = alt->bInterfaceNumber;
                *bulk_out = out_ep;
                *bulk_in = in_ep;
                found = 1;
            }
        }
    }

    libusb_free_config_descriptor(config);
    return found;
}

static int wait_for_product(libusb_context *ctx, uint16_t product, int seconds) {
    for (int i = 0; i < seconds * 2; i++) {
        libusb_device_handle *handle = libusb_open_device_with_vid_pid(ctx, HUAWEI_VENDOR, product);
        if (handle != NULL) {
            libusb_close(handle);
            return 1;
        }
        usleep(500000);
    }
    return 0;
}

int main(void) {
    libusb_context *ctx = NULL;
    int rc = libusb_init(&ctx);
    if (rc != 0) {
        die_libusb("libusb_init", rc);
    }

    libusb_device_handle *handle =
        libusb_open_device_with_vid_pid(ctx, HUAWEI_VENDOR, HUAWEI_INSTALL_MODE);
    if (handle == NULL) {
        fprintf(stderr, "Huawei install-mode device 12d1:1f01 not found.\n");
        libusb_exit(ctx);
        return 1;
    }

    uint8_t iface = 0;
    uint8_t bulk_out = 0;
    uint8_t bulk_in = 0;
    if (!find_mass_storage_interface(handle, &iface, &bulk_out, &bulk_in)) {
        fprintf(stderr, "No USB mass-storage bulk-out interface found on 12d1:1f01.\n");
        libusb_close(handle);
        libusb_exit(ctx);
        return 1;
    }

    libusb_set_auto_detach_kernel_driver(handle, 1);

    rc = libusb_claim_interface(handle, iface);
    if (rc != 0) {
        fprintf(stderr, "Could not claim interface %u. Close Finder windows for HiLink, eject it, then retry.\n", iface);
        die_libusb("libusb_claim_interface", rc);
    }

    unsigned char switch_cbw[] = {
        0x55, 0x53, 0x42, 0x43, 0x12, 0x34, 0x56, 0x78,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x11,
        0x06, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    };

    int transferred = 0;
    rc = libusb_bulk_transfer(handle, bulk_out, switch_cbw, (int)sizeof(switch_cbw), &transferred, 1000);
    if (rc != 0 || transferred != (int)sizeof(switch_cbw)) {
        fprintf(stderr, "Sent %d/%zu bytes to endpoint 0x%02x.\n", transferred, sizeof(switch_cbw), bulk_out);
        die_libusb("libusb_bulk_transfer switch message", rc);
    }

    if (bulk_in != 0) {
        unsigned char csw[13];
        transferred = 0;
        rc = libusb_bulk_transfer(handle, bulk_in, csw, (int)sizeof(csw), &transferred, 1000);
        if (rc != 0 && rc != LIBUSB_ERROR_TIMEOUT && rc != LIBUSB_ERROR_NO_DEVICE) {
            fprintf(stderr, "Warning: CSW read returned %s (%d).\n", libusb_error_name(rc), rc);
        }
    }

    libusb_release_interface(handle, iface);
    libusb_close(handle);

    printf("Switch command sent. Waiting for Huawei device to re-enumerate as 12d1:14db...\n");
    if (wait_for_product(ctx, HUAWEI_HILINK_ECM, 15)) {
        printf("Success: device appeared as 12d1:14db.\n");
        libusb_exit(ctx);
        return 0;
    }

    fprintf(stderr, "Device did not appear as 12d1:14db within 15 seconds.\n");
    libusb_exit(ctx);
    return 2;
}
