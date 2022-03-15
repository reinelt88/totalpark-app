import {AfterViewInit, Component, ViewChild} from '@angular/core';
import {AlertController, LoadingController, NavController, Platform, PopoverController} from '@ionic/angular';
import {Plugins} from '@capacitor/core';
import {GoogleMapComponent} from '../components/google-map/google-map.component';
import {StorageService} from '../../services/storage.service';
import {VehicleService} from '../../services/vehicle.service';
import {Vehicle} from '../../models/Vehicle';
import {ParkingSpace} from '../../models/ParkingSpace';
import {UtilService} from '../../services/util.service';
import {Subscription, timer} from 'rxjs';
import {CarParkService} from '../../services/carPark.service';
import {ParkingSpaceService} from '../../services/parkingSpace.service';
import {CarPark} from '../../models/CarPark';
import {ZoneService} from '../../services/zone.service';
import * as moment from 'moment-timezone';
import {Zone} from '../../models/Zone';
import {User} from '../../models/User';
import {UserService} from '../../services/user.service';
import {Payment} from '../../models/Payment';
import firebase from 'firebase/app';
import {PaymentService} from '../../services/payment.service';
import {LegendComponent} from '../../totalpark-user/legend/legend.component';

const {Geolocation} = Plugins;


@Component({
    selector: 'app-maps',
    templateUrl: './maps.page.html',
    styleUrls: [
        './styles/maps.page.scss'
    ]
})
export class MapsPage implements AfterViewInit {

    @ViewChild(GoogleMapComponent, {static: false}) _GoogleMap: GoogleMapComponent;
    map: google.maps.Map;
    mapOptions: google.maps.MapOptions = {
        zoom: 19,
        // center: {lat: 25.654581, lng: -100.383558},
        // uncomment the following line if you want to remove the default Map controls
        disableDefaultUI: true,
        // scaleControl: false,
        zoomControl: false,
        styles: [
        ],
    };

    markers: google.maps.Marker[] = [];
    subscriptions: Subscription;
    loadingElement: any;
    zone: Zone = <Zone>{};
    location: string;
    user: User = <User>{};
    vehicles: Vehicle[] = [];
    selectedVehicle = null;
    vehicle: Vehicle = <Vehicle> {};
    parkingStatus = null;
    carPark: CarPark =  <CarPark>{
        paymentMethodId: 'rs',
        paymentStatus: 'pending',
        parkStatus: 'unconfirmed',
        time: '00:00',
        amount: 0,
        requestInvoice: false,
        startDate: moment().format(),
        endDate: moment().format(),
    };
    isMyCarPark = false;
    parkingSpace: ParkingSpace = <ParkingSpace> {};
    qtyOfMarkers = 0;
    qtyParkingSpaces = 0;
    startDate = null;
    endDate = null;
    appDirectory = 'https://firebasestorage.googleapis.com/v0/b/total-park.appspot.com/o/app%2F';
    freeImage = this.appDirectory + 'libre-svg.png?alt=media&token=78849c47-713c-41ee-bdf7-ae20899fdffe';
    busyImage = this.appDirectory + 'ocupado-svg.png?alt=media&token=83c4f56b-f924-45d6-9384-a6f1194e4f28';
    inabilityImage = this.appDirectory + 'incapacidad-svg.png?alt=media&token=9de1c0f6-124b-4be4-940d-92b88ea99996';
    pointImage = this.appDirectory + 'point.png?alt=media&token=f7199d55-6ded-472e-b8e6-8bacfd91f670';
    pointRedImage = this.appDirectory + 'point-red.png?alt=media&token=177bea57-5c0c-41e4-85f7-976f7314bdab';
    timeZone = 'America/Monterrey'

    public actionSheetOptions: any = {
        header: 'Elegir Vehículos',
        backdropDismiss: false,
    };

    constructor(
        private loadingController: LoadingController,
        private storageService: StorageService,
        private vehicleService: VehicleService,
        private utilService: UtilService,
        private carParkService: CarParkService,
        private parkingSpaceService: ParkingSpaceService,
        private zoneService: ZoneService,
        private nav: NavController,
        private alertController: AlertController,
        private userService: UserService,
        private paymentService: PaymentService,
        public platform: Platform,
        public popoverController: PopoverController
    ) {
        this.loadMapStyle();
    }

    /**
     * Life cycle that start all when the user enter to map page each time
     */
    async ionViewWillEnter() {

        const loading = await this.loadingController.create({
            message: 'Cargando',
        });

        await loading.present();

        timer(1000).subscribe(() => {
            this.storageService.getObject('user').then(user => {
                if (user) {
                    this.user = user;

                    if (user.role === 'CLIENT') {
                        this.handleUserData();
                        this.initClientMapInfo();
                        this.checkParkingChanged();
                    } else {
                        this.handleSupervisorData();
                        this.initSupervisorMapInfo();
                    }
                } else {
                    this.utilService.signOut();
                }
            }, error => this.utilService.manageError(error));
        });

        await loading.dismiss();

    }

    /**
     * Handle the information of the current user
     */
    handleUserData() {
        const vehiclesPromise = this.vehicleService.getAllAsync(this.user.id);
        const lastCarParkPromise = this.carParkService.getLastCarPark(this.user.id);

        Promise.all([vehiclesPromise, lastCarParkPromise]).then(promises => {
            const vehicles = promises[0];
            const carPark = promises[1];
            this.subscriptions = vehicles.subscribe(v => {
                if (v.length > 0) {
                    this.vehicles = v;
                    this.selectedVehicle = v[0].id;
                    this.carPark.vehicleId = v[0].id;
                } else {
                    this.utilService.getToast('Debe agregar vehículos para poder usar los parquímetros',
                        4000, 'primary', true, {name: 'agregar', url: '/app/add-vehicle'});
                }
            }, error => this.utilService.manageError(error));

            if (carPark && moment().tz(this.timeZone) < moment(carPark.endDate).tz(this.timeZone)) {
                this.carPark = carPark;
                this.isMyCarPark = true;

                const vehiclePromise = this.vehicleService.get(carPark.vehicleId, this.user.id);
                const parkingSpacePromise = this.parkingSpaceService.getAsync(carPark.parkingSpaceId);

                Promise.all([vehiclePromise, parkingSpacePromise]).then(p => {
                    this.vehicle = p[0];
                    const parkingSpaceRes = p[1];
                    this.subscriptions = parkingSpaceRes.subscribe(async parkingSpace => {
                        if (parkingSpace) {
                            this.parkingSpace = parkingSpace;
                            this.startDate = this.utilService.formatDate(parkingSpace.startDate);
                            this.endDate = this.utilService.formatDate(parkingSpace.endDate);
                            if (this.parkingSpace.status === 'busy') {

                                const parkingLocation = new google.maps.LatLng(
                                    this.parkingSpace.location.latitude,
                                    this.parkingSpace.location.longitude
                                );
                                this.map.panTo(parkingLocation);
                                this.map.setZoom(18);

                                this.zone = await this.zoneService.get(this.parkingSpace.zoneID);

                                this.checkAvailability();
                            } else {
                                this.resetValues();
                            }
                        }
                    }, error => this.utilService.manageError(error));
                }, error => this.utilService.manageError(error));
            }

        }, error => this.utilService.manageError(error));
    }

    /**
     * Handle the information of the current supervisor
     */
    handleSupervisorData() {
    }

    /**
     * Init Map
     */
    ngAfterViewInit() {
        // GoogleMapComponent should be available
        this._GoogleMap.$mapReady.subscribe(map => {
            this.map = map;
            /**
             * Get curret position
             */
            this.geolocateMe();

        }, error => this.utilService.manageError(error));

    }

    /**
     * Initialize user rola map info
     */
    initClientMapInfo() {
        /**
         * Add all zones
         */
        this.zoneService.getAll().then(zones => {
            if (zones.length > 0) {
                this.printParkingsByZone(zones);
            } else {
                this.utilService.manageError('No se encontraron zonas');
            }
        }, error => this.utilService.manageError(error));
    }

    /**
     * Initialize supervisor role map info
     */
    initSupervisorMapInfo() {

        /**
         * Add all zones
         */
        this.zoneService.getBySupervisor(this.user.id).then(zones => {
            if (zones.length > 0) {
                this.printParkingsByZone(zones);
            } else {
                this.utilService.manageError('No se encontraron zonas');
            }
        }, error => this.utilService.manageError(error));
    }

    /**
     * Handle all parkingspaces that will set on map
     * @param zones
     */
    printParkingsByZone(zones: Zone[]) {
        this.setMapOnAll(null);
        zones.forEach(zone => {
            this.parkingSpaceService.getParkingSpaceByZone(zone.id).then((parkingSpaces: any) => {
                /**
                 * Avoid print zones without parkings
                 */
                if (parkingSpaces && parkingSpaces.length > 0) {
                    this.qtyParkingSpaces += parkingSpaces.length;
                    this.addZones(zone.coordenates);
                    parkingSpaces.forEach(parkingSpace => {
                        if (parkingSpace) {
                            this.addMarker(
                                parkingSpace,
                                zone,
                            );
                        }
                    });
                }
            }, error => this.utilService.manageError(error));
        });
    }

    /**
     * Life cycle for remove all subscription when the user left the page
     */
    ionViewWillLeave(): void {
        if (this.subscriptions !== undefined) {
            this.subscriptions.unsubscribe();
        }
    }

    /**
     * Add zone into a current map
     * @param zone
     */
    addZones(zone) {
        // Construct zones
        const colors = ['#036df2', '#C9D6DF', '#F7EECF', '#E3E1B2', '#F9CAC8', '#FAD9D7', '#D1C2E0', '#ADEAC3', '#90DAD9', '#F3BEBC', '#E7A8E3', '#A09CF3'];
        const randomColor = Math.floor(Math.random() * colors.length);
        const polygon = new google.maps.Polygon({
            paths: zone,
            strokeColor: colors[randomColor],
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: colors[randomColor],
            fillOpacity: 0.35,
        });
        polygon.setMap(this.map);
    }

    /**
     * Add marker into a curren map
     * @param parkingSpace
     * @param zone
     */
    addMarker(parkingSpace: ParkingSpace, zone: Zone) {
        const location = new google.maps.LatLng(Number(parkingSpace.location.latitude), Number(parkingSpace.location.longitude));

        let iconUrl;
        if (parkingSpace.type==='Discapacidad' && parkingSpace.status === 'free') {
            iconUrl = this.inabilityImage;
        } else {
            if (parkingSpace.status === 'busy' && (parkingSpace.userID === this.user.id)) {
                iconUrl = this.pointRedImage;
            } else if (parkingSpace.status === 'busy') {
                iconUrl = this.busyImage;
            } else {
                iconUrl = this.freeImage;
            }
        }

        const marker = new google.maps.Marker({
            position: location,
            title: parkingSpace.number,
            // animation: google.maps.Animation.BOUNCE,
            icon: {
                url: iconUrl,
            }
        });

        marker.addListener('click', async () => {
            this.map.setZoom(19);
            this.map.setCenter(marker.getPosition() as google.maps.LatLng);
            this.parkingSpace = parkingSpace;
            this.zone = zone;

            const geocoder = new google.maps.Geocoder();
            const infoWindow = new google.maps.InfoWindow();

            geocoder.geocode({location: location}, (
                res: google.maps.GeocoderResult[],
                stat: google.maps.GeocoderStatus) => {
                if (stat === 'OK') {
                    if (res[0]) {
                        this.carPark.address = res[0].formatted_address;
                    }
                }
            });

            if (this.parkingSpace.status === 'free') {
                this.carPark.parkingSpaceId = parkingSpace.id;
            }

            const time = this.utilService.getMinutesBetweenDates(moment(), moment(this.parkingSpace.endDate));

            let busyTime = '';
            if (Math.sign(time) === 1) {
                const hours = Math.floor(time / 60);
                busyTime = hours + 'h y ' + time % 60 + ' m';
            } else {
                busyTime = '00:00';
            }

            const infoContent = (this.parkingSpace.status === 'free') ? '<span style="color: green"><strong>' + this.parkingSpace.number + '</strong> - Disponible</span>' :
                '<span style="color: red"><strong>' + this.parkingSpace.number + '</strong> - Disponible en <strong>' + busyTime + '</strong></span>';
            infoWindow.setContent(infoContent);
            infoWindow.open(this.map, marker);
            timer(5000).subscribe(() => {
                infoWindow.close();
            }, error => this.utilService.manageError(error));

            this.isMyCarPark = (parkingSpace.userID === this.user.id);

            this.carParkService.getByparkingSpace(this.user.id, parkingSpace.id).then(carPark => {
                if (carPark) {
                    this.carPark = carPark;
                }
            })

        });

        this.markers.push(marker);
        // this.qtyOfMarkers++;
        marker.setMap(this.map);

        // if (this.qtyOfMarkers === this.qtyParkingSpaces) {
        //     new MarkerClusterer(this.map, this.markers, {
        //         maxZoom: 15,
        //         imagePath:
        //             'https://developers.google.com/maps/documentation/javascript/examples/markerclusterer/m',
        //     });
        // }
    }

    /**
     * Reset all markers
     * @param map
     */
    setMapOnAll(map: google.maps.Map | null) {
        for (let i = 0; i < this.markers.length; i++) {
            this.markers[i].setMap(map);
        }
        this.markers = [];
    }

    async dismissLoader() {
        if (this.loadingElement) {
            await this.loadingElement.dismiss();
        }
    }

    /**
     * Geolocation
     */
    public geolocateMe(manually: boolean = false): void {

        Geolocation.getCurrentPosition({timeout: 15000, enableHighAccuracy: true}).then(position => {

            this.centerMap(position.coords.latitude, position.coords.longitude, 18);

            const current_location = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);

            // add a marker
            const marker = new google.maps.Marker({
                position: current_location,
                title: 'Posición actual',
                icon: {
                    url: this.pointImage
                },
                // animation: google.maps.Animation.DROP
            });

            // To add the marker to the map, call setMap();
            marker.setMap(this.map);

            if (manually) {
                this.initClientMapInfo();
            }

        }).catch((error) => {
            console.log('Error getting current location', error);
        }).finally(() => this.dismissLoader());
    }

    /**
     * Start the parking proccess
     */
    saveParking() {
        if (this.user.role === 'CLIENT') {
            if (this.selectedVehicle !== null && this.zone !== undefined && this.parkingSpace.number !== '' && this.parkingSpace.status === 'free' && this.carPark.time !== '00:00') {
                this.carParkService.getLastCarPark(this.user.id).then(carPark => {
                    if (carPark) {
                        if (carPark.vehicleId === this.selectedVehicle &&  moment().tz(this.timeZone) < moment(carPark.endDate).tz(this.timeZone) && carPark.parkStatus === 'confirmed') {
                            this.utilService.getToast('Ya tiene un estacionamiento ocupado con el vehículo seleccionado', 4000, 'danger');
                        } else {
                            this.doParking();
                        }
                    } else {
                        this.doParking();
                    }
                }, error => this.utilService.manageError(error));

            } else {
                this.utilService.getToast('Debe seleccionar un cajón del mapa y asignarlo a un vehículo' +
                    ' por un periodo de tiempo determinado', 4000);
            }
        } else {
            this.nav.navigateForward('/wizard/' + this.parkingSpace.id);
        }

    }

    /**
     * If the role is CLIENT this function is called
     */
    doParking() {
        const m = moment().tz(this.timeZone); // TODO: Change to zone timezone
        const now = m.format();
        const endDate = m.add(this.utilService.getMinutesByTime(this.carPark.time), 'minutes').format();
        const price = (this.parkingSpace.price !== 0) ? this.parkingSpace.price : this.zone.price;
        const amount = this.utilService.calculateCarParkAmount(this.carPark.time, price);

        this.carPark.startDate = now;
        this.carPark.endDate = endDate;
        this.carPark.amount = amount;

        this.carParkService.add(this.carPark, this.user.id).then(async res => {
            if (res) {
                this.parkingSpace = <ParkingSpace> {};
                this.selectedVehicle = null;
                this.nav.navigateForward('/app/car-park/' + res.id);
                // const vehicle = await this.vehicleService.get(this.selectedVehicle, this.user.id);
                // this.parkingSpace.registrationPlate = vehicle.registrationPlate;
                // this.parkingSpaceService.update(this.parkingSpace, this.parkingSpace.id).then(() => {
                //     this.nav.navigateForward('/app/car-park/' + res.id);
                // }, error => this.utilService.manageError(error));
            }
        }, error => this.utilService.manageError(error));
    }

    /**
     * Check current ParkingSpace Availability
     */
    checkAvailability() {
        const interval = setInterval(() => {
            if (moment() >= moment(this.parkingSpace.endDate)) {
                if (this.parkingSpace.status === 'busy') {
                    this.parkingSpace.status = 'free';
                    this.parkingSpaceService.update(this.parkingSpace, this.parkingSpace.id).then(() => {
                        const notificationParkingEnd = {
                            id: 2,
                            title: 'Avisos Total Park',
                            body: 'Su tiempo de parqueo ha finalizado a las '
                                + moment(this.parkingSpace.endDate).format('h:mm a')
                        }
                        this.utilService.localNotifications([notificationParkingEnd]);
                        clearInterval(interval);
                        this.resetValues();
                    }, error => this.utilService.manageError(error));
                }
            }
        }, 1000);
    }

    /**
     * Center de current map
     * @param latitude
     * @param longitude
     * @param zoom
     */
    centerMap(latitude: number, longitude: number, zoom: number) {
        const parkingLocation = new google.maps.LatLng(
            latitude,
            longitude
        );
        this.map.panTo(parkingLocation);
        this.map.setZoom(zoom);
    }

    /**
     * Finish a parking action
     */
    endParking() {
        const m = moment().tz(this.timeZone); // TODO: Change to zone timezone
        const now = m.format();
        this.carPark.endDate = now;
        this.carParkService.update(this.carPark, this.carPark.id, this.user.id).then(() => {
            this.parkingSpace.status = 'free';
            this.parkingSpace.endDate = now;
            this.parkingSpaceService.update(this.parkingSpace, this.parkingSpace.id).then(() => {
                this.resetValues();
                this.utilService.getToast('Estacionamiento finalizado correctamente', 4000);
            }, error => this.utilService.manageError(error));
        }, error => this.utilService.manageError(error));
    }

    /**
     * Recharge of balance
     */
    async recharge() {
        const alert = await this.alertController.create({
            cssClass: 'custom-css-class',
            header: 'Tiempo a recargar',
            inputs: [
                {
                    name: '15_minutes',
                    type: 'radio',
                    label: '15 minutos',
                    value: '15',
                    handler: () => {
                        console.log('15_minutes selected');
                    },
                    checked: true
                },
                {
                    name: '30_minutes',
                    type: 'radio',
                    label: '30 minutos',
                    value: '30',
                    handler: () => {
                        console.log('30_minutes selected');
                    }
                },
                {
                    name: '45_minutes',
                    type: 'radio',
                    label: '45 minutos',
                    value: '45',
                    handler: () => {
                        console.log('45_minutes selected');
                    }
                },
                {
                    name: '60_minutes',
                    type: 'radio',
                    label: '60 minutos',
                    value: '60',
                    handler: () => {
                        console.log('60_minutes selected');
                    }
                },
            ],
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel',
                    cssClass: 'secondary',
                    handler: () => {
                        console.log('Confirm Cancel');
                    }
                }, {
                    text: 'Ok',
                    handler: async (data) => {
                        const endDate = moment(this.carPark.endDate).add(data, 'minutes');
                        this.carPark.endDate = endDate.format();
                        this.carPark.time = (((Number(this.carPark.time.replace(':', '.')) * 60 + (Number(data) / 100) * 60) / 60).toFixed(2)).replace('.', ':');
                        const price = (this.parkingSpace.price !== 0) ? this.parkingSpace.price : this.zone.price;
                        const amount = this.utilService.calculateCarParkRechargeAmount(data, price);
                        const client = await this.parkingSpaceService.getClient(this.parkingSpace.zoneID);
                        if (client) {
                            let userBalanceByClient = await this.userService.getBalanceByClientId(this.user.id, client.id);
                            if (userBalanceByClient && userBalanceByClient.balance > amount) {
                                const currentBalance = userBalanceByClient.balance;
                                userBalanceByClient.balance = userBalanceByClient.balance - this.carPark.amount;
                                /**
                                 * Make user balance change
                                 */

                                this.userService.updateBalance(userBalanceByClient, userBalanceByClient.id, this.user.id).then(() => {
                                    const payment: Payment = {
                                        type: 'carPark',
                                        amount: this.carPark.amount,
                                        actionId: this.carPark.id,
                                        currentBalance: currentBalance,
                                        clientId: client.id
                                    };

                                    /**
                                     * Make payment record
                                     */
                                    this.paymentService.add(payment, this.user.id).then(async res => {
                                        if (res) {
                                            this.carParkService.update(this.carPark, this.carPark.id, this.user.id).then(() => {
                                                this.parkingSpace.endDate = endDate.format();
                                                this.parkingSpaceService.update(this.parkingSpace, this.parkingSpace.id).then(async () => {
                                                    if (this.user.notifications.confirmationOfPaymentMade && this.platform.is('capacitor')) {
                                                        this.carParkService.update(this.carPark, this.carPark.id, this.user.id).then(async () => {
                                                            const notificationPayment = {
                                                                id: 3,
                                                                title: 'Avisos Total Park',
                                                                body: 'Ha realizado un pago de $' + amount + 'MXN' +
                                                                    ' a las ' + moment(this.parkingSpace.startDate).format('h:mm a')
                                                            }
                                                            await this.utilService.localNotifications([notificationPayment]);
                                                        })
                                                    }
                                                    await this.utilService.getToast('Tiempo de parqueo actualizado correctamente', 2000);
                                                }, error => this.utilService.manageError(error));
                                            }, error => this.utilService.manageError(error));
                                            console.log('Confirm Ok');
                                        }
                                    });
                                }, error => this.utilService.manageError(error));
                            } else {
                                this.utilService.getToast('No tiene suficiente saldo con este cliente, para pagar el estacionamiento',
                                    3000, 'primary', true, {name: 'recargar', url: '/app/payment-methods'});
                            }
                        }
                    }
                }
            ]
        });

        await alert.present();
    }

    /***
     * Load map styles depending of the daytime
     */
    loadMapStyle() {
        const duration = moment.duration(moment().tz(this.timeZone).format('HH:mm')).asHours();
        if (duration > 18) {
            this.mapOptions.styles = [
                {
                    "elementType": "geometry",
                    "stylers": [
                        {
                            "color": "#242f3e"
                        }
                    ]
                },
                {
                    "elementType": "labels.text.fill",
                    "stylers": [
                        {
                            "color": "#746855"
                        }
                    ]
                },
                {
                    "elementType": "labels.text.stroke",
                    "stylers": [
                        {
                            "color": "#242f3e"
                        }
                    ]
                },
                {
                    "featureType": "administrative.locality",
                    "elementType": "labels.text.fill",
                    "stylers": [
                        {
                            "color": "#d59563"
                        }
                    ]
                },
                {
                    "featureType": "poi",
                    "elementType": "labels.text",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "poi",
                    "elementType": "labels.text.fill",
                    "stylers": [
                        {
                            "color": "#d59563"
                        }
                    ]
                },
                {
                    "featureType": "poi.business",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "poi.park",
                    "elementType": "geometry",
                    "stylers": [
                        {
                            "color": "#263c3f"
                        }
                    ]
                },
                {
                    "featureType": "poi.park",
                    "elementType": "labels.text.fill",
                    "stylers": [
                        {
                            "color": "#6b9a76"
                        }
                    ]
                },
                {
                    "featureType": "road",
                    "elementType": "geometry",
                    "stylers": [
                        {
                            "color": "#38414e"
                        }
                    ]
                },
                {
                    "featureType": "road",
                    "elementType": "geometry.stroke",
                    "stylers": [
                        {
                            "color": "#212a37"
                        }
                    ]
                },
                {
                    "featureType": "road",
                    "elementType": "labels.icon",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "road",
                    "elementType": "labels.text.fill",
                    "stylers": [
                        {
                            "color": "#9ca5b3"
                        }
                    ]
                },
                {
                    "featureType": "road.arterial",
                    "elementType": "labels",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "road.highway",
                    "elementType": "geometry",
                    "stylers": [
                        {
                            "color": "#746855"
                        }
                    ]
                },
                {
                    "featureType": "road.highway",
                    "elementType": "geometry.stroke",
                    "stylers": [
                        {
                            "color": "#1f2835"
                        }
                    ]
                },
                {
                    "featureType": "road.highway",
                    "elementType": "labels",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "road.highway",
                    "elementType": "labels.text.fill",
                    "stylers": [
                        {
                            "color": "#f3d19c"
                        }
                    ]
                },
                {
                    "featureType": "road.local",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "transit",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "transit",
                    "elementType": "geometry",
                    "stylers": [
                        {
                            "color": "#2f3948"
                        }
                    ]
                },
                {
                    "featureType": "transit.station",
                    "elementType": "labels.text.fill",
                    "stylers": [
                        {
                            "color": "#d59563"
                        }
                    ]
                },
                {
                    "featureType": "water",
                    "elementType": "geometry",
                    "stylers": [
                        {
                            "color": "#17263c"
                        }
                    ]
                },
                {
                    "featureType": "water",
                    "elementType": "labels.text.fill",
                    "stylers": [
                        {
                            "color": "#515c6d"
                        }
                    ]
                },
                {
                    "featureType": "water",
                    "elementType": "labels.text.stroke",
                    "stylers": [
                        {
                            "color": "#17263c"
                        }
                    ]
                }
            ];
        } else {
            this.mapOptions.styles = [
                {
                    "featureType": "poi",
                    "elementType": "labels.text",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "poi.business",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "road",
                    "elementType": "labels.icon",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "road.arterial",
                    "elementType": "labels",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "road.highway",
                    "elementType": "labels",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "road.local",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                },
                {
                    "featureType": "transit",
                    "stylers": [
                        {
                            "visibility": "off"
                        }
                    ]
                }
            ]
        }
    }

    /**
     * Very important function the check all time changes on the parkingspaces
     */
    checkParkingChanged() {
        this.subscriptions = this.parkingSpaceService.getParkingSpaceChanged().subscribe(qtyChanges => {
            if (qtyChanges.length > 0) {
                qtyChanges.forEach(change => {
                    if (change.type === 'modified') {
                        const data = change.payload.doc.data();

                        const markerFound = this.markers.find(marker => {
                            return marker.getTitle() === data.number;
                        })

                        if (markerFound) {
                            markerFound.setMap(null);

                            this.markers = this.markers.filter(marker => {
                                return marker.getTitle() !== data.number;
                            })

                            this.zoneService.get(data.zoneID).then(zone => {
                                // this.qtyParkingSpaces++;
                                this.addMarker(data, zone);
                            })
                        }

                        console.log(data.number, data.status);
                    }
                })
            }
        })
    }

    /**
     * Reset form values
     */
    resetValues() {
        this.carPark =  <CarPark>{
            paymentMethodId: 'rs',
            paymentStatus: 'pending',
            parkStatus: 'unconfirmed',
            time: '00:00',
            amount: 0,
            requestInvoice: false,
            startDate: moment().format(),
            endDate: moment().format(),
        };

        this.parkingSpace = <ParkingSpace> {};
        this.selectedVehicle = null;
    }

    searchParking(number: string) {
        this.parkingSpaceService.getByNumber(number).then(async res => {
            if (res) {
                this.parkingSpace = res;
                this.centerMap(this.parkingSpace.location.latitude, this.parkingSpace.location.longitude, 18);
            } else {
                await this.utilService.getToast('No se encontraron coincidencias', 2000);
            }
        }, error => this.utilService.manageError(error));
    }

    // (ionInput)="searchByEvent($event)"
    searchByEvent($event) {
        const query = $event.target.value;

        const originalList = this.markers;

        this.markers = this.markers.filter((marker) => {
            return marker.getTitle() === query;
        });

        let intersection = originalList.filter(x => this.markers.includes(x));

        intersection.forEach(marker => {
            marker.setMap(null);
        })

        console.log(query);
    }

    vehicleCancel () {
        this.nav.navigateForward('/app/add-vehicle');
    }

    vehicleChange($event) {
        this.selectedVehicle = $event.detail.value;
    }

    resetParkSpace() {
        this.parkingSpace = <ParkingSpace> {};
    }

    async showLegend(ev: any) {
        const popover = await this.popoverController.create({
            component: LegendComponent,
            cssClass: 'legend-class',
            event: ev,
            translucent: true,
            animated: true,
            backdropDismiss: true,
            mode: 'ios',
            keyboardClose: true,
        });
        await popover.present();

        const { role } = await popover.onDidDismiss();
        console.log('onDidDismiss resolved with role', role);
    }
}
